var fs = require('fs');
var base = require('./base.js');
var template = fs.readFileSync(
  __dirname + '/templates/list.mu', { encoding: 'utf8' }
);
var ShoppingList = require('../collections/shoppingList.js');
var ListItemView = require('./listItem.js');
var shoppingService = require('../services/shoppingService.js');

module.exports = base.extend({
  el: '.view',
  collection: shoppingService.collection,
  template: template,
  initialize: function () {
    this.render();
    this.$list = this.$('.items');
    this.partials = {};
    this.collection.on('remove', this.removeItem, this);
    this.collection.on('add', this.addItem, this);
    this.collection.models.forEach(this.addItem, this);
  },
  addItem: function (model) {
    var item = new ListItemView({
      model: model,
      collection: this.collection
    });
    this.$list.append(item.el);
    this.partials[model.cid] = item;
  },
  removeItem: function (model) {
    var item = this.partials[model.cid];
    item.$list.remove();
    delete this.partials[model.cid];
  }
});
