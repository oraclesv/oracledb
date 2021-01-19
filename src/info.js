const db = require('./db')
const config = require('../config')
/**
* Return the last synchronized checkpoint
*/

let height = config.sync_height

const checkpoint = function() {
  return height
}
const updateHeight = async function(index) {
  await db.info.updateHeight(index)
  height = index
}
module.exports = {
  checkpoint: checkpoint,
  updateHeight: updateHeight,
}
