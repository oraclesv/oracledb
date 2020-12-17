const MongoClient = require('mongodb').MongoClient
const log = require('./logger').logger
var db
var mongo
var config
var init = function(_config) {
  config = _config
  return new Promise(function(resolve) {
    //TODO: deprecated interface, replace with new
    MongoClient.connect(_config.url, {useNewUrlParser: true}, function(err, client) {
      if (err) log.error(err)
      db = client.db(_config.name)
      mongo = client
      resolve()
    })
  })
}
var exit = function() {
  return new Promise(function(resolve) {
    mongo.close()
    resolve()
  })
}
var tx = {
  insert: async function(txjson) {
    try {
      let res = await db.collection('tx').insertOne(txjson)
      if (res.result['ok'] == 1) {
        log.info("insert txid %s, confirmed %s", txjson['_id'], txjson['confirmed'])
        return true
      } else {
        log.error("insert txid %s, %s failed", txjson['_id'], txjson['confirmed'])
        return false
      }
    } catch(e) {
      log.error('insert failed: %s', e)
      return false
    }
  },
  updateConfirmed: async function(txid, confirmed) {
    let res = await db.collection('tx').updateOne({'_id': txid}, {'$set': {'confirmed': confirmed}})
    if (res.result['ok'] != 1) {
      log.error('updateConfirmed failed res: %s', res)
      return false
    } else {
      log.info('updateConfirmed: %s, %s', txid, confirmed)
    }
    return true
  },
  removeAllUnconfirmed: async function() {
    let res = await db.collection('tx').deleteMany({'confirmed': 0})
    if (res.result['ok'] != 1) {
      log.error('removeAllUnconfirmed %s', res)
      throw new Error("removeAllUnconfirmed failed")
    }
  }
}

var info = {
  getHeight: async function() {
    let res = await db.collection('info').findOne({'_id': 'height'})
    if (res != null) {
      if (res.value) {
        return res.value
      }
    }
    return 0
  },
  updateHeight: async function(height) {
    let res = await db.collection('info').updateOne({'_id': 'height'}, {'$set': {'value': height}}, {'upsert': 1})
    if (res.result['ok'] != 1) {
      log.error('db.updateHeight failed res: %s', res)
      return false
    } else {
      log.info('db.updateHeight: %s', height)
    }
    return true
  }
}

var block = {
  index: async function() {
    log.info('index mongodb')

    if (config.index) {
      let collectionNames = Object.keys(config.index)
      for(let j=0; j<collectionNames.length; j++) {
        let collectionName = collectionNames[j]
        let keys = config.index[collectionName].keys
        if (keys) {
          for(let i=0; i<keys.length; i++) {
            let o = {}
            o[keys[i]] = 1
            try {
              await db.collection(collectionName).createIndex(o)
              log.info('create index %s', keys[i])
            } catch (e) {
              log.error('create index failed %s', e)
              process.exit()
            }
          }
        }
      }
    }

    log.info('finished indexing mongodb...')
  }
}
module.exports = {
  init: init, 
  exit: exit, 
  block: block, 
  tx: tx,
  info: info,
}
