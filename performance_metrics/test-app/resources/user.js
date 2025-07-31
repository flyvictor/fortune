module.exports = function (app) {
  app
    .resource(
      'user',
      {
        firstName: { type: String, required: true },
        lastName: { type: String, required: true },
        middleName: { type: String },
        dateOfBirth: { type: Date },
        gender: { type: String, enum: ['male', 'female', 'other'] },
        email: { type: String, required: true },
        password: { type: String, required: true },
        phone: { type: String },
        address: {
          type: Object,
          schema: {
            street: String,
            city: String,
            state: String,
            zip: String,
            country: String,
          },
        },
        nationality: { type: String },
        maritalStatus: {
          type: String,
          enum: ['single', 'married', 'divorced', 'widowed'],
        },
        occupation: { type: String },
        employer: { type: String },
        salary: { type: Number },
        isActive: { type: Boolean, default: true },
      },
      {},
    )
    .afterRead([
      {
        name: 'full-name',
        init: function () {
          return function () {
            this.fullName = `${this.firstName} ${this.lastName}`;
            return this;
          };
        },
      },
    ]);
};
