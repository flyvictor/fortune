require('should');
const adapter = require('../../lib/adapters/mongodb');

module.exports = function(){
  describe('MongoDB adapter helpers', function(){
    describe('removeUselessProjectionSelect', function () {
      const removeUselessProjectionSelect = adapter._helpers.removeUselessProjectionSelect;
      const model = {
        collection: {
          collectionName: 'collection'
        }
      };
      describe('object input', () => {
        it('should return empty object if inpur projection is empty object', () => {
          removeUselessProjectionSelect({
          }).should.eql({
          });
        });

        it('should not delete any projection key if all non nested keys are not part of nested keys', () => {
          removeUselessProjectionSelect({
            'nested.first': 1,
            'nested.second': 1,
            'first': 1,
            'another': 1,
           }, model).should.eql({
            'nested.first': 1,
            'nested.second': 1,
            'first': 1,
            'another': 1,
          });
        });
        it('should delete any projection key that starts on atleast one non nested ke', () => {
          removeUselessProjectionSelect({
            'nested.first': 1,
            'nested.second': 1,
            'another.second': 1,
            'another.third': 1,
            'nested': 1,
            'anoth': 1,
            'nonNested': 1,
          }, model).should.eql({
            'nested.first': 1,
            'nested.second': 1,
            'another.second': 1,
            'another.third': 1,
            'nonNested': 1,
            'anoth': 1,
          });
        });
      });

      describe('array input', () => {
        it('should return empty array if inpur projection is empty array', () => {
          removeUselessProjectionSelect([]).should.eql([]);
        });

        it('should not delete any projection key if all non nested keys are not part of nested keys', () => {
          removeUselessProjectionSelect([
            'nested.first',
            'nested.second',
            'first',
            'another',
          ], model).should.eql([
            'nested.first',
            'nested.second',
            'first',
            'another',
          ]);
        });
        it('should delete any projection key that starts on atleast one non nested ke', () => {
          removeUselessProjectionSelect([
            'nested.first',
            'nested.second',
            'another.second',
            'another.third',
            'nested',
            'anoth',
            'nonNested',
          ], model).should.eql([
            'nested.first',
            'nested.second',
            'another.second',
            'another.third',
            'anoth',
            'nonNested',
          ]);
        });
      });
    });
  });
};
