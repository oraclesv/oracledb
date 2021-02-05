const MongoClient = require('mongodb').MongoClient
const log = require('./logger').logger
const { Long, Binary, ReadPreference } = require('mongodb')
const token = require('./proto/tokenProto')
const unique = require('./proto/uniqueProto')
const dbindex = require('./dbindex')

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

const ORACLE_UTXO = 'utxo'
let oracleUtxo
oracleUtxo = {
  genid: function(txid, outputIndex) {
    log.debug('token_utxo.genid: type txid %s', typeof txid)
    const bvalue = Buffer.alloc(4)
    bvalue.writeUInt32LE(outputIndex)
    return Binary(Buffer.concat([Buffer.from(txid, 'hex'), bvalue]))
  },
  insert: async function(data) {
    try {
      data['_id'] = oracleUtxo.genid(data['txid'], data['outputIndex'])
      data['txid'] = Binary(Buffer.from(data['txid'], 'hex'))
      data['script'] = Binary(data['script'])
      data['satoshis'] = new Long(Number(data['satoshis'] & 0xFFFFFFFFn), Number((data['satoshis'] >> 32n) & 0xFFFFFFFFn))
      if (data['type'] === token.PROTO_TYPE) {
        const value = data['tokenValue']
        data['tokenValue'] = new Long(Number(value & 0xFFFFFFFFn), Number((value >> 32n) & 0xFFFFFFFFn))
        data['tokenID'] = Binary(data['tokenID'])
        data['tokenName'] = Binary(data['tokenName'])
        data['tokenSymbol'] = Binary(data['tokenSymbol'])
        data['address'] = Binary(data['address'])
      } else if (data['proto_type'] === unique.PROTO_TYPE) {
        data['uniqueID'] = Binary(data['uniqueID'])
      }

      const res = await db.collection(ORACLE_UTXO).insertOne(data)
      if (res.result['ok'] === 1) {
        if (data['type'] == token.PROTO_TYPE) {
          log.info("utxo.insert token txid %s, outputIndex %s, tokenID %s", data['txid'].toString('hex'), data['outputIndex'], data['tokenID'].toString('hex'))
        }
        else if (data['type'] == unique.PROTO_TYPE) {
          log.info("utxo.insert unique txid %s, outputIndex %s, uniqueID %s", data['txid'].toString('hex'), data['outputIndex'], data['uniqueID'].toString('hex'))
        }
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
  handleDoc: function(doc) {
    doc['satoshis'] = BigInt(doc['satoshis'])
    doc['txid'] = doc['txid'].read(0, doc['txid'].length())
    doc['script'] = doc['script'].read(0, doc['script'].length())

    if (doc['type'] == token.PROTO_TYPE) {
      doc['tokenValue'] = BigInt(doc['tokenValue'])
      doc['tokenID'] = doc['tokenID'].read(0, doc['tokenID'].length())
      doc['tokenName'] = doc['tokenName'].read(0, doc['tokenName'].length())
      doc['tokenSymbol'] = doc['tokenSymbol'].read(0, doc['tokenSymbol'].length())
      doc['address'] = doc['address'].read(0, doc['address'].length())
      log.info('db.oracleUtxo token remove utxo txid %s, outputIndex %s, address %s, tokenID %s, tokenValue %s, type %s, isGenesis %s', doc.txid.toString('hex'), doc.outputIndex, doc.address.toString('hex'), doc.tokenID.toString('hex'), doc.tokenValue, doc.type, doc.isGenesis)
    }
    else if (doc['type'] == unique.PROTO_TYPE) {
      doc['uniqueID'] = doc['uniqueID'].read(0, doc['uniqueID'].length())
      log.info('db.oracleUtxo unique remove utxo txid %s, outputIndex %s, uniqueID %s, type %s, isGenesis %s', doc.txid.toString('hex'), doc.outputIndex, doc.uniqueID.toString('hex'), doc.type, doc.isGenesis)
    }
    return doc
  },

  remove: async function(txid, outputIndex) {
    const id = oracleUtxo.genid(txid, outputIndex)
    const res = await db.collection(ORACLE_UTXO).findOneAndDelete(
      filter = {'_id': id},
      )
    if (res && res.ok === 1) {
      log.debug('db.oracleUtxo remove res: %s, %s', res, res.value)
      let value = null
      if (res.value !== null) {
        value = oracleUtxo.handleDoc(res.value)
      }
      return value
    } else {
      log.error('db.oracleUtxo remove failed res %s', res)
      return null 
    }
  },
  forEach: async function(callback) {
    await db.collection(ORACLE_UTXO).find().forEach(function(doc) {
      callback(doc)
    })
  },
  getAddressTokenUtxos: async function(address, tokenID) {
    let data = []
    await db.collection(ORACLE_UTXO).find(
      {'address': Binary(address), 'tokenID': Binary(tokenID)},
      {'projection': {'txid': 1, 'outputIndex': 1, 'satoshis': 1, 'script': 1}, 'readPreference': ReadPreference.PRIMARY_SECONDARY, 'hint': {'address': 1, 'tokenID': 1}}
      ).forEach(function(doc) {
      const utxo = {
        txid: doc['txid'].read(0, doc['txid'].length()).toString('hex'),
        outputIndex: doc['outputIndex'],
        satoshis: BigInt(doc['satoshis']).toString(),
        script: doc['script'].read(0, doc['script'].length()).toString('hex'),
      }
      log.debug('oracleUxto.getAddressTokenUtxos: find one %s', utxo)
      data.push(utxo)
    })
    return data
  },
  clear: async function() {
    await db.collection(ORACLE_UTXO).deleteMany({})
  },

  getByTxId: async function(txid, outputIndex) {
    const id = oracleUtxo.genid(txid, outputIndex)
    let res
    try {
      res = await db.collection('utxo').findOne(
        query = {'_id': id},
        options = {'readPreference': ReadPreference.SECONDARY_PREFERRED}
        )
    } catch (e) {
      log.error('oracleUtxo.getByTxId error:', e)
      return null
    }
    log.debug('db.utxo getByTxId res: %s', res)
    let doc = null
    if (res !== null) {
      doc = oracleUtxo.handleDoc(res)
    }
    log.debug('oracleUtxo.getByTxId doc: %s', doc)
    return doc
  },
}

let createIndex = async function() {
  log.info('index mongodb')

  const collectionNames = Object.keys(dbindex)
  for(let j=0; j<collectionNames.length; j++) {
    const collectionName = collectionNames[j]
    const keys = dbindex[collectionName]
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

  log.info('finished indexing mongodb...')
}

let wallet = {
  insertAddress: async function(address, walletId) {
    try {
      const data = {
        '_id': Binary(address),
        'walletId': walletId
      }
      const res = await db.collection('wallet').updateOne(
        filter = {'_id': Binary(address)},
        update = {'$set': {'walletId': walletId}},
        options = {'upsert': 1}
      )
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

const TOKEN_ID = 'tokenid'
let tokenID = {
  insert: async function(tokenID, name, symbol, decimalNum) {
    try {
      const res = await db.collection(TOKEN_ID).updateOne(
        filter = {'_id': Binary(tokenID)},
        update = {'$set': {'name': Binary(name), 'symbol': Binary(symbol), 'decimalNum': decimalNum}},
        options = {'upsert': 1}
      )
      if (res.result['ok'] === 1) {
        log.info("tokenID.insert tokenID %s, name %s, symbol %s", tokenID.toString('hex'), name.toString('hex'), symbol.toString('hex'))
        return true
      } else {
        log.error("tokenID.insert failed tokenID %s, name %s, symbol %s", tokenID.toString('hex'), name, symbol)
        return false
      }
    } catch(e) {
      log.error("tokenID.insert exception tokenID %s, name %s, symbol %s, e %s", tokenID.toString('hex'), name, symbol, e)
      return false
    }
  },

  getAllTokenIDs: async function() {
    let tokenIDs = []
    await db.collection(TOKEN_ID).find().forEach(function(doc) {
      const data = {
        tokenID: doc['_id'].read(0, doc['_id'].length()).toString('hex'),
        name: doc.name.read(0, doc.name.length()).toString('hex'),
        symbol: doc.symbol.read(0, doc.symbol.length()).toString('hex'),
        decimalNum: doc.decimalNum
      }
      tokenIDs.push(data)
    })
    return tokenIDs
  },

  findOne: async function(tokenID) {
    const res = await db.collection(TOKEN_ID).findOne({'_id': Binary(tokenID)})
    log.info('tokenID.findOne: tokenID %s, res %s', tokenID.toString('hex'), res)
    if (res !== null) {
      const data = {
        tokenID: res['_id'].read(0, res['_id'].length()),
        name: res.name.read(0, res.name.length()).toString('hex'),
        symbol: res.symbol.read(0, res.symbol.length()).toString('hex')
      }
      return data
    }
    return null
  },

  clear: async function() {
    await db.collection(TOKEN_ID).deleteMany({})
  }
}

module.exports = {
  init: init, 
  exit: exit, 
  tx: tx,
  info: info,
  oracleUtxo: oracleUtxo,
  wallet: wallet,
  tokenID: tokenID,
  createIndex: createIndex,
}
