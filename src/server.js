const express = require('express')
const bsv = require('bsv')
const log = require('./logger').logger
const ipfilter = require('express-ipfilter').IpFilter

const app = express()

const server = module.exports

server.app = app

let httpserver

const db = require('./db')

server.start = function(config) {
  app.use(express.json()) // for parsing application/json
  app.use(express.urlencoded({ extended: true })) // for parsing application/x-www-form-urlencoded

  // ip whitelist
  if (config.whitelist !== undefined) {
    app.use(ipfilter(config.whitelist, { mode: 'allow' }))
  }

  app.get('/', function(req, res) {
    res.json({'ok': 1, 'res': 'oracledb api'})
  })

  app.get('/get_tokenid_list', async function(req, res) {
    const dbres = await db.tokenID.getAllTokenIDs()

    if (dbres !== null) {
      res.json({'ok': 1, 'res': dbres})
    } else {
      res.json({'ok': 0, 'error': 'canot get tokenid list from mongodb'})
    }
  })

  app.get('/get_token_utxos', async function(req, res) {
    const params = req.query
    log.debug("get_token_utxos params %s", params)
    let address, tokenID
    try {
      address = bsv.Address.fromString(params.address)
      tokenID = Buffer.from(params.tokenid, 'hex')
    } catch (e) {
      log.error('get_token_utxos: %s', e)
    }

    if (address === null || tokenID === null) {
      res.json({'ok': 0, 'error': 'address or tokenID is not illegal'})
      return
    }
    const dbres = await db.oracleUtxo.getAddressTokenUtxos(address.hashBuffer, tokenID)
    res.json({'ok': 1, 'res': dbres})
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