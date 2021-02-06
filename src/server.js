const express = require('express')
const bsv = require('bsv')
const log = require('./logger').logger
const ipfilter = require('express-ipfilter').IpFilter
const cache = require('./cache')
const Rabin = require('./rabin/rabin')
const {toBufferLE} = require('bigint-buffer')

const app = express()

const server = module.exports

server.app = app

let httpserver

const db = require('./db')

server.start = function(config, rabinConfig) {
  app.use(express.json()) // for parsing application/json
  app.use(express.urlencoded({ extended: true })) // for parsing application/x-www-form-urlencoded

  // ip whitelist
  if (config.whitelist !== undefined) {
    app.use(ipfilter(config.whitelist, { mode: 'allow' }))
  }

  app.get('/', function(req, res) {
    res.json({'ok': 1, 'res': 'oracledb api'})
  })

  app.get('/get_tokenid_list', function(req, res) {
    const tokenIDs = cache.getAllTokenIDInfo()
    res.json({'ok': 1, 'res': tokenIDs})
  })

  app.get('/get_token_utxos', async function(req, res) {
    const params = req.query
    log.debug("get_token_utxos params %s", params)
    let address, tokenID
    try {
      address = bsv.Address.fromString(params.address)
      tokenID = Buffer.from(params.tokenid, 'hex')
    } catch (e) {
      log.warn('get_token_utxos wrong params: %s', e)
    }

    if (address === null || tokenID === null) {
      res.json({'ok': 0, 'error': 'address or tokenID is not illegal'})
      return
    }
    const dbres = await db.oracleUtxo.getAddressTokenUtxos(address.hashBuffer, tokenID)
    res.json({'ok': 1, 'res': dbres})
  })

  app.get('/get_token_utxo_rabin_sig', async function(req, res) {
    const params = req.query
    log.debug("get_token_utxo_rabin_sig params %s", params)
    if (params.txid === undefined || params.outputindex === undefined) {
      res.json({'ok': 0, 'error': 'txid or outputindex is not illegal'})
      return
    }
    let txid, outputIndex
    try {
      txid = params.txid
      outputIndex = parseInt(params.outputindex)
    } catch (e) {
      log.error('get_token_utxos: %s', e)
      res.json({'ok': 0, 'error': e})
      return
    }

    const dbres = await db.oracleUtxo.getByTxId(txid, outputIndex)
    if (dbres === null) {
      res.json({'ok': 0, 'error': 'this uxto is not a legal token utxo'})
      return
    }

    const indexBuf = Buffer.alloc(4, 0)
    indexBuf.writeUInt32LE(outputIndex)
    const txidBuf = Buffer.from([...Buffer.from(txid, 'hex')].reverse())
    const scriptHashBuf = bsv.crypto.Hash.sha256ripemd160(dbres.script)
    const satoshisBuf = Buffer.alloc(8, 0)
    satoshisBuf.writeBigUInt64LE(BigInt(dbres.satoshis))
    const bufValue = Buffer.alloc(8, 0)
    bufValue.writeBigUInt64LE(dbres.tokenValue)

    const msg = Buffer.concat([
      txidBuf,
      indexBuf,
      scriptHashBuf,
      satoshisBuf,
      bufValue,
      dbres.tokenID,
    ])
    const privKey = rabinConfig.privKey
    const pubKey = rabinConfig.pubKey

    const rabinSignResult = Rabin.sign(msg.toString('hex'), privKey.p, privKey.q, pubKey)
    const sigBuf = toBufferLE(rabinSignResult.signature, 128)
    const padding = Buffer.alloc(rabinSignResult.paddingByteCount, 0)
    const data = {
      'msg': msg.toString('hex'),
      'sig': sigBuf.toString('hex'),
      'padding': padding.toString('hex'),
      'pubkey': pubKey.toString(),
    }
    res.json({'ok': 1, 'res': data})
  })

  app.post('/reg_address', async function(req, res) {
    try {
      const ip = req.ip

      log.info('server.res_address ip %s, body %s', ip, req.body)
      const address = req.body.address
      const walletId = req.body.walletId
      addr = bsv.Address.fromString(address)
      let dbres = await db.wallet.insertAddress(addr.hashBuffer, walletId)
      if (dbres === true) {
        res.json({'ok': 1})
      } else {
        res.json({'ok': 0, 'error': 'insert failed'})
      }
    } catch(e) {
      log.error('server.reg_address error %s, stack %s', e, e.stack)
      res.json({'ok': 0, 'error': e})
    }
  })

  httpserver = app.listen(config.port, config.ip, function() {
    log.info("start at listen %s:%s", config.ip, config.port)
  })
}

server.close = async function() {
  await httpserver.close()
}