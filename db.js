const MongoClient = require('mongodb').MongoClient
var db
var mongo
var config
var init = function(_config) {
  config = _config
  return new Promise(function(resolve) {
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
  insert: function(item) {
    return db.collection('tx').insertOne(item)
  }
}

var info = {
  getHeight: function() {
    res =  db.collection('info').findOne({'_id': 'height'})
    return res
  },
  updateHeight: function(height) {
    res = db.collection('info').updateOne({'_id': 'height'}, {'value': height, 'upsert': 1})
  }
}

var mempool =  {
  insert: function(item) {
    return db.collection('unconfirmed').insertMany([item])
  },
  reset: async function() {
    await db.collection('unconfirmed').deleteMany({}).catch(function(err) {
      console.log('## ERR ', err)
      process.exit()
    })
  },
  sync: async function(items) {
    await db.collection('unconfirmed').deleteMany({}).catch(function(err) {
      console.log('## ERR ', err)
    })
    let index = 0
    while (true) {
      let chunk = items.splice(0, 1000)
      if (chunk.length > 0) {
        await db.collection('unconfirmed').insertMany(chunk, { ordered: false }).catch(function(err) {
          // duplicates are ok because they will be ignored
          if (err.code !== 11000) {
            console.log('## ERR ', err, items)
            process.exit()
          }
        })
        console.log('..chunk ' + index + ' processed ...', new Date().toString())
        index++
      } else {
        break
      }
    }
    console.log('Mempool synchronized with ' + items.length + ' items')
  }
}
var block = {
  reset: async function() {
    await db.collection('confirmed').deleteMany({}).catch(function(err) {
      console.log('## ERR ', err)
      process.exit()
    })
  },
  replace: async function(items, block_index) {
    console.log('Deleting all blocks greater than or equal to', block_index)
    await db.collection('confirmed').deleteMany({
      'blk.i': {
        $gte: block_index
      }
    }).catch(function(err) {
      console.log('## ERR ', err)
      process.exit()
    })
    console.log('Updating block', block_index, 'with', items.length, 'items')
    let index = 0
    while (true) {
      let chunk = items.slice(index, index+1000)
      if (chunk.length > 0) {
        await db.collection('confirmed').insertMany(chunk, { ordered: false }).catch(function(err) {
          // duplicates are ok because they will be ignored
          if (err.code !== 11000) {
            console.log('## ERR ', err, items)
            process.exit()
          }
        })
        console.log('\tchunk ' + index + ' processed ...')
        index+=1000
      } else {
        break
      }
    }
  },
  insert: async function(items, block_index) {
    let index = 0
    while (true) {
      let chunk = items.slice(index, index+1000)
      if (chunk.length > 0) {
        try {
          await db.collection('confirmed').insertMany(chunk, { ordered: false })
          console.log('..chunk ' + index + ' processed ...')
        } catch (e) {
          // duplicates are ok because they will be ignored
          if (e.code !== 11000) {
            console.log('## ERR ', e, items, block_index)
            process.exit()
          }
        }
        index+=1000
      } else {
        break
      }
    }
    console.log('Block ' + block_index + ' inserted ')
  },
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

    try {
      let result = await db.collection('confirmed').indexInformation({full: true})
      console.log('* Confirmed Index = ', result)
      result = await db.collection('unconfirmed').indexInformation({full: true})
      console.log('* Unonfirmed Index = ', result)
    } catch (e) {
      console.log('* Error fetching index info ', e)
      process.exit()
    }
  }
}
module.exports = {
  init: init, exit: exit, block: block, mempool: mempool, tx: tx
}
