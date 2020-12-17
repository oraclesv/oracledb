const zmq = require('zeromq')
const RpcClient = require('bitcoind-rpc')
const pLimit = require('p-limit')
const pQueue = require('p-queue')
const bsv = require('bsv')
const Config = require('./config.js')
const db = require('./db.js')
const log = require('./logger').logger
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
          const limit = pLimit(Config.rpc.limit)
          let txs = ret.result
          log.info('txs length: %s', txs.length)
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
    const limit = pLimit(Config.rpc.limit)
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
    unconfirmed[tx.id] = 1
    await Db.tx.insert(jsontx)
  }
}

const processConfirmedTx = async function(tx) {
  if (isBacktraceTx(tx)) {
    log.info("processConfirmedTx: %s, %s", tx.id, unconfirmed[tx.id])
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
  log.info("preocessRawBlock: transaction length %s, %s", block.transactions.length, block)
  for (var i = 0; i < block.transactions.length; i++) {
    await processConfirmedTx(block.transactions[i])
  }
}

const sync = async function(type, hash) {
  if (type === 'block') {
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
        log.info('syn finished]')
        return currentHeight
      }
    } catch (e) {
      log.error('sync block failed %s', e)
      log.error('Shutting down oracledb...')
      await Db.exit()
      process.exit()
    }
  } else if (type === 'mempool') {
    //TODO:
    queue.add(async function() {
      let content = await request.tx(hash)
      try {
        await Db.mempool.insert(content)
        log.info('queue inserted [size: %s], %s', queue.size, hash)
        log.info(content)
      } catch (e) {
        // duplicates are ok because they will be ignored
        if (e.code == 11000) {
          log.info('Duplicate mempool item: %s', content)
        } else {
          log.error('## ERR %s, %s', e, content)
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
