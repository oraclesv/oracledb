require('dotenv').config()
const Config = require('./config.js')
const Filter = require('./bitdb.json')
const Info = require('./info.js')
const Bit = require('./bit.js')
const Db = require('./db')

const daemon = {
  run: async function() {
    // 1. Initialize
    await Db.init(Config.db)
    await Bit.init(Db, Info)

    // 2. Bootstrap actions depending on first time
    let dbheight = await Db.info.getHeight()
    let height = Math.max(dbheight, Info.checkpoint())
    console.log("height:", dbheight, height)
    await Info.updateHeight(height)

    console.log("init db height:", height)

    console.time('Indexing Keys')
    await Db.block.index()
    console.timeEnd('Indexing Keys')

    // 3. Start synchronizing
    console.log('Synchronizing...', new Date())
    console.time('Initial Sync')
    await Bit.run()
    console.timeEnd('Initial Sync')

    // 4. Start listening
    Bit.listen()
  }
}
const util = {
  run: async function() {
    await Db.init(Config.db)
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
      await Db.block.reset()
      await Db.mempool.reset()
      process.exit()
    } else if (cmd === 'index') {
      await Db.block.index()
      process.exit()
    }
  },
  fix: async function(from) {
    console.log('Restarting from index ', from)
    console.time('replace')
    await Bit.init(Db, Info)
    let content = await Bit.crawl(from)
    await Db.block.replace(content, from)
    console.log('Block', from, 'fixed.')
    await Info.updateHeight(from)
    console.log('[finished]')
    console.timeEnd('replace')
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
