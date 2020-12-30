const zmq = require('zeromq')
const RpcClient = require('bitcoind-rpc')
const pLimit = require('p-limit')
const bsv = require('bsv')
const retry = require('retry')

const config = require('./config.js')
const log = require('./logger').logger
const oracle = require('./oracle')
const cache = require('./cache')
const db = require('./db')

let Info
let rpc

const unconfirmed = {}

const init = function(info) {
  return new Promise(function(resolve) {
    Info = info
    //db = db
    rpc = new RpcClient(config.rpc)
    resolve()
  })
}
const request = {
  block: function(block_index) {
    return new Promise(function(resolve, reject) {
      let operation = retry.operation({
        retries: 10,
        factor: 3,
        minTimeout: 1 * 1000,
        maxTimeout: 100 * 1000,
        randomize: true,
      })
      operation.attempt(function(currentAteempt) {
        rpc.getBlockHash(block_index, function(err, res) {
          if (operation.retry(err)) {
            return
          } 
          if (err) {
            log.error('rpc.getBlockHash failed: %s, err %s', block_index, err)
            reject(new Error(err))
          } else {
            rpc.getBlock(res.result, function(err, block) {
              resolve(block)
            })
          }
        })
      })
    })
  },
  /**
  * Return the current blockchain height
  */
  height: function() {
    return new Promise(function(resolve, reject) {
      let operation = retry.operation({
        retries: 10,
        factor: 3,
        minTimeout: 1 * 1000,
        maxTimeout: 100 * 1000,
        randomize: true,
      })
      operation.attempt(function(currentAteempt) {
        rpc.getBlockCount(function(err, res) {
          if (operation.retry(err)) {
            return
          } 
          if (err) {
            log.error('rpc.getBlockCount failed %s', err)
            reject(new Error(err))
          } else {
            resolve(res.result)
          }
        })
      })
    })
  },
  tx: async function(hash) {
    return new Promise(function(resolve, reject) {
      let operation = retry.operation({
        retries: 10,
        factor: 3,
        minTimeout: 1 * 1000,
        maxTimeout: 100 * 1000,
        randomize: true,
      })
      operation.attempt(function(currentAteempt) {
        rpc.getRawTransaction(hash, function(err, res) {
          log.debug('request.tx: currentAteempt %s, err %s', currentAteempt, err)
          if (operation.retry(err)) {
            return
          }
          if (err) {
            log.error('getRawTransaction failed, hash %s, err %s', hash, err)
            reject(new Error(err))
          } else {
            resolve(res.result)
          }
        })
      })
    })
  },
  mempool: function() {
    return new Promise(function(resolve) {
      rpc.getRawMemPool(async function(err, ret) {
        if (err) {
          log.error('getRawMemmPool failed: %s', err)
          resolve(null)
        } else {
          let tasks = []
          const limit = pLimit(config.rpc.max_concurrency)
          let txs = ret.result
          log.info('getRawMemPool: txs length: %s', txs.length)
          for(let i=0; i<txs.length; i++) {
            tasks.push(limit(async function() {
              log.debug("mempool: request tx %s", txs[i])
              try {
                let rawtx = await request.tx(txs[i])
                const txid = await processRawTx(rawtx)
                return txid
              } catch(e) {
                log.error("getRawMemPool error: %s")
                return null
              }
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
  let block_content
  try {
    block_content = await request.block(block_index)
  } catch(err) {
    block_content = null
    log.error('crawl block failed: err %s, err.stack %s', err, err.stack)
  }

  if (block_content && block_content.result) {
    let txs = block_content.result.tx
    log.info('crawling txs: %s', txs.length)
    let tasks = []
    const limit = pLimit(config.rpc.max_concurrency)
    for(let i = 0; i < txs.length; i++) {
      if (unconfirmed[txs[i]] !== undefined) {
        if (unconfirmed[txs[i]] === true) {
          await db.tx.updateConfirmed(txs[i], 1)
        }
        log.debug('crawl delete unconfirmed tx %s, %s', txs[i], unconfirmed[txs[i]])
        delete unconfirmed[txs[i]]
        continue
      }
      tasks.push(limit(async function() {
        try {
          let rawtx = await request.tx(txs[i])
          txid = await processRawTx(rawtx, confirmed=1)
          return txid
        } catch(err) {
          log.error("crawl requet error %s, stack %s", err, err.stack)
        }
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
  sock.connect('tcp://' + config.zmq.incoming.host + ':' + config.zmq.incoming.port)
  //sock.subscribe('hashtx')
  sock.subscribe('hashblock')
  sock.subscribe('rawtx')
  //sock.subscribe('rawblock')
  log.info('Subscriber connected to port %s', config.zmq.incoming.port)

  // Listen to ZMQ
  sock.on('message', async function(topic, message) {
    if (topic.toString() === 'rawtx') {
      log.debug("zmq new rawtx")
      await processRawTx(message, confirmed=0)
    } else if (topic.toString() === 'hashblock') {
      log.info("zmq new hashblock %s", message)
      await syncBlock()
    }
  })

  // Don't trust ZMQ. Try synchronizing every 2 minute in case ZMQ didn't fire
  setInterval(async function() {
    await syncBlock()
  }, 120000)

}

const processRawTx = async function(rawtx, confirmed=0) {
  let tx = new bsv.Transaction()
  tx.fromBuffer(rawtx)
  log.debug('processRawTx: id %s, confirmed %s', tx.id, confirmed)
  if (confirmed === 1) {
    await processConfirmedTx(tx)
  } else {
    await processTx(tx)
  }
  return tx.id
}

const processTx = async function(tx) {
  let res = await oracle.processTx(tx)
  unconfirmed[tx.id] = res
  if (res) {
    log.info('processTx: new tx: %s', tx.id)
    let jsontx = tx.toJSON()
    jsontx['_id'] = jsontx['hash']
    delete jsontx['hash']
    jsontx['confirmed'] = 0 
    await db.tx.insert(jsontx)
  }
}

const processConfirmedTx = async function(tx) {
  if (unconfirmed[tx.id] !== undefined) {
    if (unconfirmed[tx.id] === true) {
      await db.tx.updateConfirmed(tx.id, 1)
    }
    log.debug('processConfirmed delete unconfirmed tx %s, %s', tx.id, unconfirmed[tx.id])
    delete unconfirmed[tx.id]
  } else {
    let res = await oracle.processTx(tx)
    if (res) {
      log.info('processConfirmedTx: new oracle tx:', tx.id)
      let jsontx = tx.toJSON()
      jsontx['_id'] = jsontx['hash']
      delete jsontx['hash']
      jsontx['confirmed'] = 1
      await db.tx.insert(jsontx)
    }
  }
}

/*const processRawBlock = async function(rawblock) {
  // TODO: big block performance
  let block = bsv.Block.fromRawBlock(rawblock)
  log.info("processRawBlock: transaction length %s, %s", block.transactions.length, block)
  let tasks = []
  // use concurrency
  let limit = pLimit(config.tx_max_concurrency)
  for (let i = 0; i < block.transactions.length; i++) {
    task.push(limit(async function() {
      await processConfirmedTx(block.transactions[i])
    }))
  }
  await Promise.all(tasks)
}*/

const syncBlock = async function() {
  try {
    const lastSynchronized = Info.checkpoint()
    const currentHeight = await request.height()
    log.info('lastSynchronized %s, bsv curentHeight %s', lastSynchronized, currentHeight)

    for(let index=lastSynchronized+1; index<=currentHeight; index++) {
      log.info('start crawl new block txs index %s', index)
      await crawl(index)

      await Info.updateHeight(index)
      log.info('updateHeight: %s', index)
    }

    if (lastSynchronized === currentHeight) {
      return null
    } else {
      log.info('syn finished')
      return currentHeight
    }
  } catch (e) {
    log.error('sync block failed %s, %s', e, e.stack)
    //log.error('Shutting down oracledb...')
    //await db.exit()
    //process.exit()
  }
}

const syncUtxoCache = async function() {
  await db.utxo.forEach(function(myDoc) {
    const txid = myDoc.txid.read(0, myDoc.txid.length()).toString('hex')
    const outputIndex = myDoc.outputIndex
    cache.addUtxo(txid, outputIndex)
    log.debug('syncUtxoCache: add utxo id %s, index %s', txid, outputIndex)
  })
}

const run = async function() {

  await syncUtxoCache()

  // clear all unconfirmed tx
  await db.tx.removeAllUnconfirmed()

  // initial block sync
  await syncBlock()

  // initial mempool sync
  await request.mempool()
}
module.exports = {
  init: init, 
  listen: listen, 
  run: run
}
