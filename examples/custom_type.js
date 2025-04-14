var fortune = require('../lib/fortune');
/*
* Example application.
*/
var app = fortune({
db: 'petstore'
})
.customType('price', { //Define 'price' custom type. It's have no instance, only used in metadata.
  amount: Number,
  units: String
})
.resource('person', {
  name: String,
  age: Number,
  pets: ['pet'] // "has many" relationship to pets
})
.resource('pet', {
  name: String,
  age: Number,
  owner: 'person', // "belongs to" relationship to a person
  cost: 'price' //Using previous defined custom type 'price'
  /*  cost: 'price'
   *   
   *  is equal to this:
   *
   *  cost : {
   *    amount: Number,
   *    units: String
   *  }
   */
})
.listen(1337);//Start the API


