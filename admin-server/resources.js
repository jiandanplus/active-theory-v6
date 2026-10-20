// Compatibility facade: existing consumers keep their public imports.
const {mountStorageRoutes} = require('./routes/storages');
const {mountResourceRoutes} = require('./routes/resources');
const {mountMediaRoutes} = require('./routes/media');
const {references, commitResource} = require('./services/resources');

function mountResources(context) {
  mountStorageRoutes(context);
  mountResourceRoutes(context);
  mountMediaRoutes(context);
}
module.exports = {mountResources, references, commitResource};
