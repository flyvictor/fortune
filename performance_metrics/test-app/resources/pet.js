module.exports = function (app) {
  app.resource('pet', {
    name: { type: String, required: true },
    type: { type: String, required: true }, // e.g. dog, cat, bird
    breed: { type: String },
    age: { type: Number },
    owner: { ref: 'user', required: true }, // link to user _id
    documents: [{ ref: 'pet-document', inverse: 'pet' }],
  });
};
