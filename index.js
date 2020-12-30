const config = require('./config.js')
const Info = require('./info.js')
const Bit = require('./bit.js')
const db = require('./db')
const log = require('./logger').logger
const server = require('./server')

const daemon = {
  run: async function() {
    // 1. Initialize
    await db.init(config.db)
    await Bit.init(Info)

    // 2. Bootstrap actions depending on first time
    let dbheight = await db.info.getHeight()
    let height = Math.max(dbheight, Info.checkpoint())
    log.info('init dbheight %d, config height %d', dbheight, height)
    await Info.updateHeight(height)

    await db.createIndex()

    // 3. Start synchronizing
    await Bit.run()

    // 4. Start listening
    Bit.listen()

    // start http server
    server.start(config.http)
  }
}
const start = async function() {
  daemon.run()
}
start()
