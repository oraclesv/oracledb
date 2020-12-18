const zmq = require('zeromq')
const RpcClient = require('bitcoind-rpc')
const pLimit = require('p-limit')
const pQueue = require('p-queue')
const bsv = require('bsv')
const Config = require('./config.js')
const db = require('./db.js')
const log = require('./logger').logger
const backtrace = require('./backtrace')
//const queue = new pQueue({concurrency: Config.rpc.max_concurrency})

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
          log.error('getBlockHash failed: ', err)
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
          log.error('get height failed: ', err)
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
          log.error('getRawTransaction failed: ', err)
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
          log.error('getRawMemmPool failed: %s', err)
        } else {
          let tasks = []
          const limit = pLimit(Config.rpc.max_concurrency)
          let txs = ret.result
          log.info('getRawMemPool: txs length: %s', txs.length)
          for(let i=0; i<txs.length; i++) {
            tasks.push(limit(async function() {
              let rawtx = await request.tx(txs[i]).catch(function(e) {
                log.error('getRawTx failed %s', e)
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

  if (block_content && block_content.result) {
    let txs = block_content.result.tx
    log.debug('crawling txs: %s, %s', txs.length, txs)
    let tasks = []
    const limit = pLimit(Config.rpc.max_concurrency)
    for(let i = 0; i < txs.length; i++) {
      tasks.push(limit(async function() {
        let rawtx = await request.tx(txs[i]).catch(function(e) {
          log.error('getRawTx failed %s', e)
        })
        txid = await processRawTx(rawtx, confirmed=1)
        return txid
      }))
    }
    let btxs = await Promise.all(tasks)

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
  log.info('Subscriber connected to port %s', Config.zmq.incoming.port)

  // Listen to ZMQ
  sock.on('message', async function(topic, message) {
    if (topic.toString() === 'rawtx') {
      log.debug("zmq new rawtx")
      await processRawTx(message, confirmed=0)
    } else if (topic.toString() === 'rawblock') {
      log.debug("zmq new rawblock")
      await processRawBlock(message)
    }
  })

  // Don't trust ZMQ. Try synchronizing every 1 minute in case ZMQ didn't fire
  setInterval(async function() {
    await syncBlock()
  }, 120000)

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
  let res = await backtrace.processTx(tx)
  unconfirmed[tx.id] = res
  if (res) {
    log.info('processTx: new backtrace tx: %s', tx.id)
    let jsontx = tx.toJSON()
    jsontx['_id'] = jsontx['hash']
    delete jsontx['hash']
    jsontx['confirmed'] = 0 
    unconfirmed[tx.id] = 1
    await Db.tx.insert(jsontx)
  }
}

const processConfirmedTx = async function(tx) {
  if (unconfirmed[tx.id] !== undefined) {
    if (unconfirmed[tx.id] == true) {
      await db.tx.updateConfirmed(tx.id, 1)
    }
    delete unconfirmed[tx.id]
  } else {
    let res = await backtrace.processTx(tx)
    if (res) {
      log.info('processConfirmedTx: new backtrace tx:', tx.id)
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
  log.info("preocessRawBlock: transaction length %s, %s", block.transactions.length, block)
  let tasks = []
  // use the db concurrency
  let limit = pLimit(Config.tx_max_concurrency)
  for (var i = 0; i < block.transactions.length; i++) {
    task.push(limit(async function() {
      await processConfirmedTx(block.transactions[i])
    }))
  }
  await Promise.all(tasks)
}

const syncBlock = async function() {
  try {
    const lastSynchronized = Info.checkpoint()
    const currentHeight = await request.height()
    log.info('lastSynchronized %s, bsv curentHeight %s', lastSynchronized, currentHeight)

    for(let index=lastSynchronized+1; index<=currentHeight; index++) {
      log.info('start crawl new block txs')
      await crawl(index)

      await Info.updateHeight(index)
      log.info('updateHeight: %s', index)
    }

    if (lastSynchronized === currentHeight) {
      log.info('no need sync block, %s, %s', lastSynchronized, currentHeight)
      return null
    } else {
      log.info('syn finished')
      return currentHeight
    }
  } catch (e) {
    log.error('sync block failed %s, %s', e, e.stack)
    log.error('Shutting down oracledb...')
    await Db.exit()
    process.exit()
  }
}
const run = async function() {

  // clear all unconfirmed tx
  await Db.tx.removeAllUnconfirmed()

  // initial block sync
  await syncBlock()

  // initial mempool sync
  request.mempool()
}
module.exports = {
  init: init, 
  listen: listen, 
  run: run
}
