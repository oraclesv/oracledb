const MongoClient = require('mongodb').MongoClient
var db
var mongo
var config
var init = function(_config) {
  config = _config
  return new Promise(function(resolve) {
    //TODO: deprecated interface, replace with new
    MongoClient.connect(_config.url, {useNewUrlParser: true}, function(err, client) {
      if (err) console.log(err)
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
        console.log("insert tx", txjson['_id'], txjson['confirmed'])
        return true
      } else {
        console.error("insert tx failed", txjson['_id'], txjson['confirmed'])
        return false
      }
    } catch(e) {
      console.error('error:', e)
      return false
    }
  },
  updateConfirmed: async function(txid, confirmed) {
    let res = await db.collection('tx').updateOne({'_id': txid}, {'$set': {'confirmed': confirmed}})
    if (res.result['ok'] != 1) {
      console.error('updateConfirmed failed res:', res)
      return false
    } else {
      console.log('updateConfirmed: ', txid)
    }
    return true
  },
  removeAllUnconfirmed: async function() {
    let res = await db.collection('tx').deleteMany({'confirmed': 0})
    if (res.result['ok'] != 1) {
      console.error('removeAllUnconfirmed', res)
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
      console.error('updateHeight failed res:', res)
      return false
    }
    return true
  }
}

var block = {
  index: async function() {
    console.log('* Indexing MongoDB...')
    console.time('TotalIndex')

    if (config.index) {
      let collectionNames = Object.keys(config.index)
      for(let j=0; j<collectionNames.length; j++) {
        let collectionName = collectionNames[j]
        let keys = config.index[collectionName].keys
        if (keys) {
          console.log('Indexing keys...')
          for(let i=0; i<keys.length; i++) {
            let o = {}
            o[keys[i]] = 1
            console.time('Index:' + keys[i])
            try {
              if (keys[i] === 'tx.h') {
                await db.collection(collectionName).createIndex(o, { unique: true })
                console.log('* Created unique index for ', keys[i])
              } else {
                await db.collection(collectionName).createIndex(o)
                console.log('* Created index for ', keys[i])
              }
            } catch (e) {
              console.log(e)
              process.exit()
            }
            console.timeEnd('Index:' + keys[i])
          }
        }
      }
    }

    console.log('* Finished indexing MongoDB...')
    console.timeEnd('TotalIndex')
  }
}
module.exports = {
  init: init, 
  exit: exit, 
  block: block, 
  tx: tx,
  info: info,
}
