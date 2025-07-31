const fetch = require('node-fetch');

async function fetchPetOwner(petId) {
  const response = await fetch.default(`http://localhost:4000/pets/${petId}`);

  const data = await response.json();
  return data.pets[0].links.owner;
}

module.exports = function (app) {
  app
    .resource('pet-document', {
      name: { type: String, required: true }, // Name of the document (e.g. Vaccination Certificate)
      type: { type: String, required: true }, // Type of document (vaccination, registration, insurance, etc.)
      issueDate: { type: Date, required: true }, // When the document was issued
      expiryDate: { type: Date }, // When the document expires, if applicable
      fileUrl: { type: String, required: true }, // URL of the document file
      fileType: { type: String }, // Mime type of the document (application/pdf, image/jpeg, etc.)
      fileSize: { type: Number }, // Size of the document file in bytes
      issuingAuthority: { type: String }, // Who issued the document (vet, municipality, insurer)
      notes: { type: String }, // Additional notes about this document
      pet: { ref: 'pet', inverse: 'documents', required: true }, // link to pet _id
      petOwner: { ref: 'user', required: true }, // link to user _id
    })
    .beforeWrite([
      {
        name: 'set-pet-owner',
        init: function () {
          return async function (req) {
            if (req.method === 'POST') {
              const petId = this.links.pet;
              if (petId) {
                this.links.petOwner = await fetchPetOwner(petId);
              }
            }

            if (req.method === 'PATCH') {
              const petId = this.$set?.pet;
              if (petId) {
                this.$set.petOwner = await fetchPetOwner(petId);
              }
            }

            return this;
          };
        },
      },
    ]);
};
