const config = require('./config.js')
const Info = require('./info.js')
const Bit = require('./bit.js')
const db = require('./db')
const log = require('./logger').logger

const daemon = {
  run: async function() {
    // 1. Initialize
    await db.init(config.db)
    await Bit.init(db, Info)

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
  }
}
const util = {
  run: async function() {
    await db.init(config.db)
    let cmd = process.argv[2]
    if (cmd === 'fix') {
      let from
      if (process.argv.length > 3) {
        from = parseInt(process.argv[3])
      } else {
        from = Info.checkpoint()
      }
      await util.fix(from)
      process.exit()
    } else if (cmd === 'reset') {
      await db.block.reset()
      await db.mempool.reset()
      process.exit()
    } else if (cmd === 'index') {
      await db.createIndex()
      process.exit()
    }
  },
  fix: async function(from) {
    log.info('Restarting from index %s', from)
    log.info('replace')
    await Bit.init(db, Info)
    let content = await Bit.crawl(from)
    await db.block.replace(content, from)
    log.info('Block %s from', from)
    await Info.updateHeight(from)
    log.info('[finished]')
    log.info('replace')
  }
}
const start = async function() {
  if (process.argv.length > 2) {
    util.run()
  } else {
    daemon.run()
  }
}
start()
