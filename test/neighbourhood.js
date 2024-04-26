const executeUpdate = async (adapter, resource, id, update) => {
  const match = await adapter.preupdate(resource, id);
  return adapter.update(resource, match, update);
};

module.exports = async function(adapter, ids) {
  //Housing
  await executeUpdate(adapter, 'house', ids.houses[0], { owners: [ids.people[0]] });
  await executeUpdate(adapter, 'house', ids.houses[1], { owners: [ids.people[1]] });
  await executeUpdate(adapter, 'house', ids.houses[2], { owners: [ids.people[2]] });
  await executeUpdate(adapter, 'house', ids.houses[3], { owners: [ids.people[3]] });

  //Lovers and haters
  await executeUpdate(adapter, 'person', ids.people[0], { soulmate: ids.people[1] });
  await executeUpdate(adapter, 'person', ids.people[3], { soulmate: ids.people[2] });
  await executeUpdate(adapter, 'person', ids.people[0], { lovers: [ids.people[1], ids.people[2], ids.people[3]] });

  //Pets
  await executeUpdate(adapter, 'pet', ids.pets[0], { owner: ids.people[1] });
  await executeUpdate(adapter, 'pet', ids.pets[1], { owner: ids.people[3] });

  //Cars
  await executeUpdate(adapter, 'car', ids.cars[0], { owner: ids.people[0] });
  await executeUpdate(adapter, 'car', ids.cars[1], { owner: ids.people[1] });
};

