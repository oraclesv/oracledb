const MongoClient = require('mongodb').MongoClient
const log = require('./logger').logger
const { Long, Binary } = require('mongodb')

let db
let mongo
let config
let init = function(_config) {
  config = _config
  return new Promise(function(resolve) {
    MongoClient.connect(_config.url, {useNewUrlParser: true, useUnifiedTopology: true}, function(err, client) {
      if (err) log.error(err)
      db = client.db(_config.name)
      mongo = client
      resolve()
    })
  })
}
let exit = function() {
  return new Promise(function(resolve) {
    mongo.close()
    resolve()
  })
}
let tx = {
  insert: async function(txjson) {
    try {
      const res = await db.collection('tx').insertOne(txjson)
      if (res.result['ok'] === 1) {
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
    const res = await db.collection('tx').updateOne({'_id': txid}, {'$set': {'confirmed': confirmed}})
    if (res.result['ok'] !== 1) {
      log.error('updateConfirmed failed res: %s', res)
      return false
    } else {
      log.info('updateConfirmed: %s, %s', txid, confirmed)
    }
    return true
  },
  removeAllUnconfirmed: async function() {
    const res = await db.collection('tx').deleteMany({'confirmed': 0})
    if (res.result['ok'] !== 1) {
      log.error('removeAllUnconfirmed %s', res)
      throw new Error("removeAllUnconfirmed failed")
    }
  }
}

let info = {
  getHeight: async function() {
    const res = await db.collection('info').findOne({'_id': 'height'})
    if (res !== null) {
      if (res.value) {
        return res.value
      }
    }
    return 0
  },
  updateHeight: async function(height) {
    const res = await db.collection('info').updateOne({'_id': 'height'}, {'$set': {'value': height}}, {'upsert': 1})
    if (res.result['ok'] !== 1) {
      log.error('db.updateHeight failed res: %s', res)
      return false
    } else {
      log.info('db.updateHeight: %s', height)
    }
    return true
  }
}

let utxo
utxo = {
  genid: function(txid, outputIndex) {
    log.debug('utxo.genid: type txid %s', typeof txid)
    const bvalue = Buffer.alloc(4)
    bvalue.writeUInt32LE(outputIndex)
    return Binary(Buffer.concat([Buffer.from(txid, 'hex'), bvalue]))
  },
  insert: async function(data) {
    try {
      data['_id'] = utxo.genid(data['txid'], data['outputIndex'])
      data['txid'] = Binary(Buffer.from(data['txid'], 'hex'))
      const value = data['tokenValue']
      data['tokenValue'] = new Long(Number(value & 0xFFFFFFFFn), Number((value >> 32n) & 0xFFFFFFFFn))
      data['tokenID'] = Binary(data['tokenID'])
      data['address'] = Binary(data['address'])
      data['script'] = Binary(data['script'])
      data['satoshis'] = new Long(Number(data['satoshis'] & 0xFFFFFFFFn), Number((data['satoshis'] >> 32n) & 0xFFFFFFFFn))
      const res = await db.collection('utxo').insertOne(data)
      if (res.result['ok'] === 1) {
        log.info("utxo.insert txid %s, outputIndex %s, tokenID %s", data['txid'].toString('hex'), data['outputIndex'], data['tokenID'].toString('hex'))
        return true
      } else {
        log.error("utxo.insert txid %s, %s failed", data['txid'].toString('hex'), data['outputIndex'])
        return false
      }
    } catch(e) {
      log.error('utxo.insert failed: %s', e)
      return false
    }
  },
  remove: async function(txid, outputIndex) {
    const id = utxo.genid(txid, outputIndex)
    const res = await db.collection('utxo').findOneAndDelete(
      filter = {'_id': id},
      )
    if (res && res.ok === 1) {
      log.debug('db.utxo remove res: %s', res)
      let value = null
      if (res.value !== null) {
        value = res.value
        value['tokenValue'] = BigInt(value['tokenValue'])
        value['satoshis'] = BigInt(value['tokenValue'])
        value['txid'] = value['txid'].read(0, value['txid'].length())
        value['tokenID'] = value['tokenID'].read(0, value['tokenID'].length())
        value['address'] = value['address'].read(0, value['address'].length())
        value['script'] = value['script'].read(0, value['script'].length())
        log.info('db.utxo remove utxo txid %s, outputIndex %s, address %s, tokenID %s, tokenValue %s, type %s, isGenesis %s', value.txid.toString('hex'), value.outputIndex, value.address.toString('hex'), value.tokenID.toString('hex'), value.tokenValue, value.type, value.isGenesis)
      }
      return value
    } else {
      log.error('db.utxo remove failed res %s', res)
      return null 
    }
  },
  forEach: async function(callback) {
    await db.collection('utxo').find().forEach(function(myDoc) {
      callback(myDoc)
    })
  },
  clear: async function() {
    await db.collection('utxo').deleteMany({})
  }
}

let createIndex = async function() {
  log.info('index mongodb')

  if (config.index) {
    const collectionNames = Object.keys(config.index)
    for(let j=0; j<collectionNames.length; j++) {
      const collectionName = collectionNames[j]
      const keys = config.index[collectionName].keys
      if (keys) {
        for(let i=0; i<keys.length; i++) {
          try {
            const res = await db.collection(collectionName).createIndex(keys[i])
            log.info('create index %s, res %s', keys[i], res)
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

let wallet = {
  insertAddress: async function(address, walletId) {
    try {
      const data = {
        '_id': Binary(address),
        'walletId': walletId
      }
      const res = await db.collection('wallet').insertOne(data)
      if (res.result['ok'] === 1) {
        log.info("wallet.insert address %s, %s", address.toString('hex'), walletId)
        return true
      } else {
        log.error("wallet.insert address %s, %s failed", address.toString('hex'), walletId)
        return false
      }
    } catch(e) {
      log.error('wallet.insert address failed: %s, %s, %s', e, address, walletId)
      return false
    }
  },
  getWalletId: async function(address) {
    const res = await db.collection('wallet').findOne({'_id': Binary(address)})
    if (res !== null) {
      if (res.walletId) {
        return res.walletId
      }
    }
    return null
  },
  clear: async function() {
    await db.collection('wallet').deleteMany({})
  }
}

module.exports = {
  init: init, 
  exit: exit, 
  tx: tx,
  info: info,
  utxo: utxo,
  wallet: wallet,
  createIndex: createIndex,
}
