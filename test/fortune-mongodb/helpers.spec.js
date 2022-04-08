require('should');
const adapter = require('../../lib/adapters/mongodb');

module.exports = function(){
  describe('MongoDB adapter helpers', function(){
    describe('removeUselessProjection', function () {
      const removeUselessProjection = adapter._helpers.removeUselessProjection;
      const model = {
        collection: {
          collectionName: 'collection'
        }
      };

      it('should return empty object if inpur projection is empty object', () => {
        removeUselessProjection({}).should.eql({});
      });

      it('should not delete any projection key if all non nested keys are not part of nested keys', () => {
        removeUselessProjection({
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
        removeUselessProjection({
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
  });
};

