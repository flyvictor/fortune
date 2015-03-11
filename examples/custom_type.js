var fortune = require('../lib/fortune');
/*
* Example application.
*/
var app = fortune({
db: 'petstore'
})
.customType('price', {
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
cost: 'price'
})
.listen(1337);//Start the API


