const should = require('should');
const sinon = require('sinon');
const LinkingBooster = require('../../lib/linking-booster');

module.exports = function () {
  describe('linking booster', function () {
    let mockResources, booster, director;

    beforeEach(function () {
      mockResources = {
        person: {
          schema: {
            pets: [{ ref: 'pet', inverse: 'owner' }],
            cats: { ref: 'pet' },
            employer: { ref: 'business', external: true },
            estate: { ref: 'house', inverse: 'landlord' },
            houses: [{ ref: 'house', inverse: 'owner' }],
          },
        },
        pet: {
          schema: {
            owner: { ref: 'person', inverse: 'pets' },
            toys: [{ ref: 'toy', inverse: 'pet' }],
          },
        },
        toy: {
          schema: {
            pet: { ref: 'pet', inverse: 'toys' },
          },
        },
        house: {
          schema: {
            landlord: { ref: 'person', inverse: 'estate' },
            owner: { ref: 'person', inverse: 'houses' },
          },
        },
      };

      const directMethods = {
        get: sinon.stub().returns(Promise.resolve()),
      };
      director = {
        methods: directMethods,
      };
      const inflect = {};
      inflect.pluralize = function (str) {
        return {
          pet: 'pets',
          person: 'people',
          toy: 'toys',
          house: 'houses',
        }[str];
      };

      booster = LinkingBooster.init(director, inflect, mockResources);
    });

    it('should skip for no includes', function (done) {
      booster.groupIncludes = sinon.stub();
      booster.startLinking({ query: {} }).then(function () {
        booster.groupIncludes.callCount.should.equal(0);
        done();
      });
    });
    it('should group requests to same resource', function () {
      const req = {
        path: '/people/personId',
        query: { include: 'pets,pets.toys' },
      };
      const includes = ['pets', 'pets.toys'];
      const groups = booster.groupIncludes(req, includes);
      groups.pets.as.should.equal('pets');
      groups.pets.resource.should.equal('pets');
      groups.pets.filter.should.eql({ owner: { $in: ['personId'] } });
      groups.pets.include[0].should.eql([]);
      groups.pets.include[1][0].should.equal('toys');
    });
    it('should handle case of two paths referencing single resource type', function () {
      const req = {
        path: '/people/personId',
        query: { include: 'houses,estate' },
      };
      const includes = ['houses', 'estate'];
      const groups = booster.groupIncludes(req, includes);
      groups.houses.as.should.eql('houses');
      groups.houses.resource.should.equal('houses');
      groups.houses.filter.should.eql({ owner: { $in: ['personId'] } });
      groups.estate.as.should.equal('houses');
      groups.estate.resource.should.equal('houses');
      groups.estate.filter.should.eql({ landlord: { $in: ['personId'] } });
    });
    it('should ignore invalid includes', function () {
      const req = { path: '/people/personId', query: { include: 'pets,bad' } };
      const includes = ['pets', 'bad'];
      const groups = booster.groupIncludes(req, includes);
      should.exist(groups.pets);
      Object.keys(groups).length.should.equal(1);
    });
    it('should be able to define if include can be boosted', function () {
      booster
        .canBoost({ path: '/people/personId', query: { include: 'pets' } })
        .should.equal(true);
      booster
        .canBoost({ path: '/people', query: { include: 'employer' } })
        .should.equal(false);
      booster
        .canBoost({ path: '/people/', query: { include: 'pets' } })
        .should.equal(false);
      booster
        .canBoost({ path: '/people/personId', query: {} })
        .should.equal(false);
    });
    it('should not try to include external refs', function () {
      const req = { path: '/people/personId', query: { include: 'employer' } };
      const includes = ['employer'];
      const groups = booster.groupIncludes(req, includes);
      groups.should.eql({});
    });
    it('should not try to fetch local refs if the link is one-way', function () {
      const req = { path: '/people/personId', query: { include: 'cats' } };
      const includes = ['cats'];
      const groups = booster.groupIncludes(req, includes);
      groups.should.eql({});
    });
    it('should set scopedIncludes for series linker', function () {
      const req = {
        path: '/people/personId',
        query: { include: 'pets,employer' },
      };
      const includes = ['pets', 'employer'];
      booster.groupIncludes(req, includes);
      req.query.include.should.equal('pets,employer');
      req.scopedIncludes.should.equal('employer');
    });
    it('should pass proper request params to director to fetch related resources', function (done) {
      const req = {
        path: '/people/personId',
        query: {
          include: 'pets',
        },
      };
      director.methods.get.returns(Promise.resolve({}));
      booster.startLinking(req).then(function () {
        const directArgs = director.methods.get.getCall(0).args;
        directArgs[0].should.equal('pets');
        directArgs[1].should.eql({
          query: {
            filter: { owner: { $in: ['personId'] } },
            include: '',
          },
          params: undefined,
          path: undefined,
          originalIncludes: undefined,
          scopedIncludes: undefined,
        });
        done();
      });
    });

    it('should be able to merge received result', function (done) {
      const req = {
        path: '/people/personId',
        query: { include: 'pets,pets.toys' },
        originalIncludes: ['pets', 'pets.toys'],
      };
      const linker = Promise.resolve([
        {
          as: 'pets',
          path: 'pets',
          data: {
            pets: [{ owner: 'personId', id: 'petId' }],
            linked: { toys: [{ id: 'toyId' }] },
          },
        },
      ]);
      const mainBody = {
        people: [
          {
            id: 'personId',
            pets: ['petId'],
          },
        ],
        links: {
          'people.pets': { type: 'pets' },
        },
      };
      booster.mergeResults(req, linker, mainBody).then(function (merged) {
        merged.people[0].id.should.equal('personId');
        merged.links['people.pets'].type.should.equal('pets');
        merged.linked.pets[0].id.should.equal('petId');
        should.exist(merged.linked.toys);
        merged.linked.toys[0].id.should.equal('toyId');
        done();
      });
    });
    it('should properly merge links section', function (done) {
      const linker = Promise.resolve([
        {
          as: 'soulmate',
          path: 'soulmate',
          data: {
            people: [],
            links: {
              'people.pets': { type: 'pets' },
            },
          },
        },
      ]);
      const req = {
        path: '/people/personId',
        query: {
          include: 'soulmate',
        },
        originalIncludes: ['soulmate'],
      };
      const body = { people: [], links: { 'people.soulmate': {} }, linked: {} };
      booster.mergeResults(req, linker, body).then(function (merged) {
        should.exist(merged.links['people.soulmate']);
        should.exist(merged.links['people.soulmate.pets']);
        done();
      });
    });
    it('should have method to decide if link type should be included in main response', function () {
      let req = { query: { include: 'soulmate,soulmate.pets' } };
      booster.includeInBody(req, 'soulmate').should.equal(true);
      req = { query: { include: 'soulmate.pets' } };
      booster.includeInBody(req, 'soulmate').should.equal(false);
      req = { query: { include: 'soulmate.pets.toys' } };
      booster.includeInBody(req, 'soulmate').should.equal(false);
      booster.includeInBody(req, 'pets').should.equal(false);
      booster.includeInBody(req, 'toys').should.equal(true);
      req = { query: { include: 'soulmate.pets,soulmate.pets.toys' } };
      booster.includeInBody(req, 'soulmate').should.equal(false);
      booster.includeInBody(req, 'pets').should.equal(true);
      booster.includeInBody(req, 'toys').should.equal(true);
    });
    it('should not include intermediate documents', function (done) {
      const linker = Promise.resolve([
        {
          as: 'soulmate',
          data: {
            people: [{ id: 'personId' }],
            links: {
              'people.pets': { type: 'pets' },
              'people.pets.owner': { type: 'people' },
            },
            linked: {
              people: [{ id: 'ownerId' }],
            },
          },
        },
      ]);
      const req = {
        path: '/people/personId',
        query: {
          include: 'soulmate.pets.owner',
        },
        originalIncludes: ['soulmate.pets.owner'],
      };
      const body = { people: [], links: { 'people.soulmate': {} }, linked: {} };
      booster.mergeResults(req, linker, body).then(function (merged) {
        //Pets won't be there as appendLinked won't include it
        should.not.exist(merged.linked.pets);
        should.exist(merged.linked.people);
        merged.linked.people[0].id.should.equal('ownerId');
        merged.linked.people.length.should.equal(1);
        done();
      });
    });
  });
};
