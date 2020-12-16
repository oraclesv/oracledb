const zmq = require('zeromq')
const RpcClient = require('bitcoind-rpc')
const pLimit = require('p-limit')
const pQueue = require('p-queue')
const bsv = require('bsv')
const Config = require('./config.js')
const db = require('./db.js')
const queue = new pQueue({concurrency: Config.rpc.limit})

var Db
var Info
var rpc

let unconfirmed = {}

const init = function(db, info) {
  return new Promise(function(resolve) {
    Db = db
    Info = info

    rpc = new RpcClient(Config.rpc)
    resolve()
  })
}
const request = {
  block: function(block_index) {
    return new Promise(function(resolve) {
      rpc.getBlockHash(block_index, function(err, res) {
        if (err) {
          console.log('Err = ', err)
          throw new Error(err)
        } else {
          rpc.getBlock(res.result, function(err, block) {
            resolve(block)
          })
        }
      })
    })
  },
  /**
  * Return the current blockchain height
  */
  height: function() {
    return new Promise(function(resolve) {
      rpc.getBlockCount(function(err, res) {
        if (err) {
          console.log('Err = ', err)
          throw new Error(err)
        } else {
          resolve(res.result)
        }
      })
    })
  },
  tx: function(hash) {
    return new Promise(function(resolve) {
      rpc.getRawTransaction(hash, function(err, res) {
        if (err) {
          console.log('Err = ', err)
          throw new Error(err)
        } else {
          resolve(res.result)
        }
      })
    })
  },
  mempool: function() {
    return new Promise(function(resolve) {
      rpc.getRawMemPool(async function(err, ret) {
        if (err) {
          console.log('Err', err)
        } else {
          let tasks = []
          const limit = pLimit(Config.rpc.limit)
          let txs = ret.result
          console.log('txs = ', txs.length)
          for(let i=0; i<txs.length; i++) {
            tasks.push(limit(async function() {
              let rawtx = await request.tx(txs[i]).catch(function(e) {
                console.log('Error = ', e)
              })
              txid = await processRawTx(rawtx, confirmed=1)
              return txid
            }))
          }
          let btxs = await Promise.all(tasks)
          resolve(btxs)
        }
      })
    })
  }
}
const crawl = async function(block_index) {
  let block_content = await request.block(block_index)
  //console.log('block_content', block_content)

  if (block_content && block_content.result) {
    let txs = block_content.result.tx
    console.log('crawling txs = ', txs.length)
    console.log('crawling txs:', txs)
    let tasks = []
    const limit = pLimit(Config.rpc.limit)
    for(let i = 0; i < txs.length; i++) {
      tasks.push(limit(async function() {
        let rawtx = await request.tx(txs[i]).catch(function(e) {
          console.log('Error = ', e)
        })
        txid = await processRawTx(rawtx, confirmed=1)
        return txid
      }))
    }
    let btxs = await Promise.all(tasks)

    console.log('Block ' + block_index + ' : ' + txs.length + 'txs | ' + btxs.length + ' filtered txs')
    return btxs
  } else {
    return []
  }
}
const listen = function() {
  let sock = zmq.socket('sub')
  sock.connect('tcp://' + Config.zmq.incoming.host + ':' + Config.zmq.incoming.port)
  //sock.subscribe('hashtx')
  //sock.subscribe('hashblock')
  sock.subscribe('rawtx')
  sock.subscribe('rawblock')
  console.log('Subscriber connected to port ' + Config.zmq.incoming.port)

  // Listen to ZMQ
  sock.on('message', async function(topic, message) {
    if (topic.toString() === 'rawtx') {
      console.log('New rawtx from ZMQ')
      await processRawTx(message, confirmed=0)
    } else if (topic.toString() === 'rawblock') {
      console.log('New block from ZMQ')
      await processRawBlock(message)
    }
  })

  // Don't trust ZMQ. Try synchronizing every 1 minute in case ZMQ didn't fire
  setInterval(async function() {
    await sync('block')
  }, 120000)

}

const isBacktraceTx = function(tx) {
  // TODO: check the tx
  return true
}

const processRawTx = async function(rawtx, confirmed=0) {
  let tx = new bsv.Transaction()
  tx.fromBuffer(rawtx)
  if (confirmed == 1) {
    await processConfirmedTx(tx)
  } else {
    await processTx(tx)
  }
  return tx.id
}

const processTx = async function(tx) {
  if (isBacktraceTx(tx)) {
    let jsontx = tx.toJSON()
    //TODO: use hash as the mongo _id, if _id performance will be affected, hash must be unique
    jsontx['_id'] = jsontx['hash']
    delete jsontx['hash']
    jsontx['confirmed'] = 0 
    //console.log('processTx: jsontx', jsontx)
    unconfirmed[tx.id] = 1
    await Db.tx.insert(jsontx)
  }
}

const processConfirmedTx = async function(tx) {
  if (isBacktraceTx(tx)) {
    console.log("tx: ", tx.id, unconfirmed)
    if (unconfirmed[tx.id]) {
      delete unconfirmed[tx.id] 
      await db.tx.updateConfirmed(tx.id, 1)
    } else {
      let jsontx = tx.toJSON()
      jsontx['_id'] = jsontx['hash']
      delete jsontx['hash']
      jsontx['confirmed'] = 1
      await Db.tx.insert(jsontx)
    }
  }
}

const processRawBlock = async function(rawblock) {
  let block = bsv.Block.fromRawBlock(rawblock)
  console.log("preocessRawBlock: transaction length:", block.transactions.length, block)
  for (var i = 0; i < block.transactions.length; i++) {
    await processConfirmedTx(block.transactions[i])
  }
}

const sync = async function(type, hash) {
  if (type === 'block') {
    try {
      const lastSynchronized = Info.checkpoint()
      const currentHeight = await request.height()
      console.log('Last Synchronized = ', lastSynchronized)
      console.log('Current Height = ', currentHeight)

      for(let index=lastSynchronized+1; index<=currentHeight; index++) {
        console.log('RPC BEGIN ' + index, new Date().toString())
        console.time('RPC END ' + index)
        await crawl(index)
        console.timeEnd('RPC END ' + index)

        await Info.updateHeight(index)
        console.log('updateHeight:', index)
      }

      if (lastSynchronized === currentHeight) {
        console.log('no update')
        return null
      } else {
        console.log('[finished]')
        return currentHeight
      }
    } catch (e) {
      console.log('Error', e)
      console.log('Shutting down oracledb...', new Date().toString())
      await Db.exit()
      process.exit()
    }
  } else if (type === 'mempool') {
    queue.add(async function() {
      let content = await request.tx(hash)
      try {
        await Db.mempool.insert(content)
        console.log('# Q inserted [size: ' + queue.size + ']',  hash)
        console.log(content)
      } catch (e) {
        // duplicates are ok because they will be ignored
        if (e.code == 11000) {
          console.log('Duplicate mempool item: ', content)
        } else {
          console.log('## ERR ', e, content)
          process.exit()
        }
      }
    })
    return hash
  }
}
const run = async function() {

  // clear all unconfirmed tx
  await Db.tx.removeAllUnconfirmed()

  // initial block sync
  await sync('block')

  // initial mempool sync
  request.mempool()
}
module.exports = {
  init: init, crawl: crawl, listen: listen, sync: sync, run: run
}
