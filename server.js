const express = require('express')
const log = require('./logger').logger
const ipfilter = require('express-ipfilter').IpFilter

const app = express()

const server = module.exports

const db = require('./db')

server.start = function(config) {
  app.use(express.json()) // for parsing application/json
  app.use(express.urlencoded({ extended: true })) // for parsing application/x-www-form-urlencoded

  // ip whitelist
  app.use(ipfilter(config.whitelist, { mode: 'allow' }))

  app.get('/', function(req, res) {
    res.send('oracledb api')
  })

  app.post('/reg_address', async function(req, res) {
    try {
      const ip = req.ip

      log.info('server.res_address ip %s, body %s', ip, req.body)
      const address = req.body.address
      const walletId = req.body.walletId
      addr = bsv.Address.fromPublicKeyHash(address)
      let dbres = await db.wallet.insertAddress(addr.hashBuffer, walletId)
      if (dbres === true) {
        res.send('insert address success')
      } else {
        res.send('insert address failed')
      }
    } catch(e) {
      log.error('server.reg_address error %s, stack %s', e, e.stack)
      res.send('insert address failed ' + e)
    }
  })

  app.listen(config.port, config.ip, function() {
    log.info("start at listen %s:%s", config.ip, config.port)
  })
}