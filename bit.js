const zmq = require('zeromq')
const RpcClient = require('bitcoind-rpc')
const TNA = require('tna')
const pLimit = require('p-limit')
const pQueue = require('p-queue')
const bsv = require('bsv')
const Config = require('./config.js')
const { db } = require('./config.js')
const queue = new pQueue({concurrency: Config.rpc.limit})

var Db
var Info
var rpc

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
  tx: async function(hash) {
    let content = await TNA.fromHash(hash, Config.rpc)
    return content
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
              let content = await request.tx(txs[i]).catch(function(e) {
                console.log('Error = ', e)
              })
              return content
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
  console.log('block_content', block_content)
  let block_hash = block_content.result.hash
  let block_time = block_content.result.time

  if (block_content && block_content.result) {
    let txs = block_content.result.tx
    console.log('crawling txs = ', txs.length)
    let tasks = []
    const limit = pLimit(Config.rpc.limit)
    for(let i=0; i<txs.length; i++) {
      tasks.push(limit(async function() {
        let t = await request.tx(txs[i]).catch(function(e) {
          console.log('Error = ', e)
        })
        t.blk = {
          i: block_index,
          h: block_hash,
          t: block_time
        }
        return t
      }))
    }
    let btxs = await Promise.all(tasks)

    //TODO: filter the tx
    //if (filter) {
    //  btxs = btxs.filter(function(row) {
    //    return filter.test(row)
    //  })

    //  if (processor) {
    //    btxs = bcode.decode(btxs)
    //    btxs  = await jq.run(processor, btxs)
    //  }
    //  console.log('Filtered Xputs = ', btxs.length)
    //}

    console.log('Block ' + block_index + ' : ' + txs.length + 'txs | ' + btxs.length + ' filtered txs')
    return btxs
  } else {
    return []
  }
}
const listen = function() {
  let sock = zmq.socket('sub')
  sock.connect('tcp://' + Config.zmq.incoming.host + ':' + Config.zmq.incoming.port)
  sock.subscribe('hashtx')
  sock.subscribe('hashblock')
  sock.subscribe('rawtx')
  sock.subscribe('rawblock')
  console.log('Subscriber connected to port ' + Config.zmq.incoming.port)

  // Listen to ZMQ
  sock.on('message', async function(topic, message) {
    if (topic.toString() === 'hashtx') {
      let hash = message.toString('hex')
      console.log('New mempool hash from ZMQ = ', hash)
      //await sync('mempool', hash)
    } else if (topic.toString() === 'hashblock') {
      let hash = message.toString('hex')
      console.log('New block hash from ZMQ = ', hash)
      //await sync('block')
    } else if (topic.toString() === 'rawtx') {
      console.log('New rawtx from ZMQ')
      //TODO: not await
      await processRawTx(message)
    } else if (topic.toString() === 'rawblock') {
      console.log('New block from ZMQ')
      await processRawBlock(message)
    }
  })

  // Don't trust ZMQ. Try synchronizing every 1 minute in case ZMQ didn't fire
  setInterval(async function() {
    await sync('block')
  }, 60000)

}

const isBacktraceTx = function(tx) {
  return true
}

const processRawTx = async function(rawtx) {
  let tx = new bsv.Transaction()
  tx.fromBuffer(rawtx)
  await processTx(tx)
}

const processTx = async function(tx) {
  if (isBacktraceTx(tx)) {
    //TODO: check the tx
    let jsontx = tx.toJSON()
    //TODO: use hash as the mongo _id, if _id performance will be affected, hash must be unique
    jsontx['_id'] = jsontx['hash']
    delete jsontx['hash']
    console.log('processTx: jsontx', jsontx)
    let res = await Db.tx.insert(jsontx)
    //TODO: handle the failed situation
    console.log('processTx: insert res:', res)
  }
}

const processRawBlock = async function(rawblock) {
  let block = bsv.Block.fromRawBlock(rawblock)
  //block.fromBuffer(rawblock)
  for (var i = 0; i < block.transactions.length; i++) {
    await processTx(block.transactions[i])
  }
}

const sync = async function(type, hash) {
  //TODO:
  if (type === 'block11') {
    try {
      const lastSynchronized = Info.checkpoint()
      const currentHeight = await request.height()
      console.log('Last Synchronized = ', lastSynchronized)
      console.log('Current Height = ', currentHeight)

      for(let index=lastSynchronized+1; index<=currentHeight; index++) {
        console.log('RPC BEGIN ' + index, new Date().toString())
        console.time('RPC END ' + index)
        let content = await crawl(index)
        console.timeEnd('RPC END ' + index)
        console.log(new Date().toString())
        console.log('DB BEGIN ' + index, new Date().toString())
        console.time('DB Insert ' + index)

        await Db.block.insert(content, index)

        await Info.updateTip(index)
        console.timeEnd('DB Insert ' + index)
        console.log('------------------------------------------')
        console.log('\n')

        // zmq broadcast
        let b = { i: index, txs: content }
        console.log('Zmq block = ', JSON.stringify(b, null, 2))
      }

      // clear mempool and synchronize
      if (lastSynchronized < currentHeight) {
        console.log('Clear mempool and repopulate')
        let items = await request.mempool()
        await Db.mempool.sync(items)
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
      console.log('Shutting down Bitdb...', new Date().toString())
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

  // initial block sync
  await sync('block')

  // initial mempool sync
  console.log('Clear mempool and repopulate')
  let items = await request.mempool()
  await Db.mempool.sync(items)
}
module.exports = {
  init: init, crawl: crawl, listen: listen, sync: sync, run: run
}
