const fortune = require('../lib/fortune'),
  crypto = require('crypto');

const pbkdf2 = {
  iterations: Math.pow(2, 16),
  keylen: Math.pow(2, 8),
};

/**
 * Example application that securely stores private information.
 * This example highlights a lot of custom application logic that
 * can be used for transforming resources as requests come in.
 */
const app = fortune({
  db: 'keystore',
})
  /*!
   * Authentication middleware
   */
  .use(authentication)

  /*!
   * Define resources
   */
  .resource('user', {
    name: String,
    password: String,
    salt: Buffer,
    keys: ['key'],
    tokens: ['token'],
  })
  .transform(
    // before storing in database
    async function (request) {
      let user = this;
      const password = user.password;
      const id = user.id || request.path.split('/').pop();

      // require a password on user creation
      if (request.method == 'post') {
        if (!!password) {
          return hashPassword(user, password);
        } else {
          throw new Error('Password is required on user creation.');
        }
      }

      // update a user
      const resource = await checkUser(id, request);
      if (!password) return user;

      user = hashPassword(user, password);

      // clear tokens after password change
      await Promise.all(
        (resource.links.tokens || []).map(function (id) {
          return app.adapter.delete('token', id);
        }),
      );
      return user;

      function hashPassword(user, password) {
        const salt = crypto.randomBytes(Math.pow(2, 4));
        user.password = crypto.pbkdf2Sync(
          password,
          salt,
          pbkdf2.iterations,
          pbkdf2.keylen,
        );
        user.salt = salt;
        return user;
      }
    },

    // after retrieving from database
    async function (request) {
      const user = this;
      delete user.password;
      delete user.salt;
      try {
        await checkUser(user.id, request);
      } catch (error) {
        delete user.links;
      }
      return user;
    },
  )

  .resource('token', {
    owner: 'user',
    value: String,
  })
  .transform(checkOwner, checkOwner)
  .noIndex()

  .resource('key', {
    name: String,
    privateKey: String,
    publicKey: String,
    owner: 'user',
  })
  .transform(checkOwner, checkOwner)
  .noIndex()

  /*!
   * Start the API
   */
  .listen(process.argv[2] || 1337);

/**
 * Custom authentication route. The request must have the header
 * `Content-Type: application/json`, and the request body must be
 * a JSON object that contain two fields: `name` and `password`.
 * It returns a token as the response body which should be
 * used as the `Authorization` header for subsequent requests.
 */
async function authentication(req, res, next) {
  if (!req.path.match(/authenticate/i)) return next();
  if (req.header('content-type') != 'application/json') {
    return res.send(412);
  }
  let name, password;
  try {
    name = req.body.name;
    password = req.body.password;
  } catch (error) {
    res.send(400);
  }
  try {
    const user = await app.adapter.find('user', { name: name });
    const derivedKey = crypto.pbkdf2Sync(
      password,
      user.salt.buffer,
      pbkdf2.iterations,
      pbkdf2.keylen,
    );
    if (derivedKey != user.password) return res.send(401);
    const token = {
      value: crypto.randomBytes(Math.pow(2, 6)).toString('base64'),
      links: {
        owner: user.id,
      },
    };
    const createdToken = await app.adapter.create('token', token);
    res.send(200, createdToken.value);
  } catch (error) {
    res.send(403);
  }
}

/**
 * Check if it's allowed to read/write based on the "owner" value.
 */
async function checkOwner(request) {
  const resource = this;
  await checkUser(resource.links.owner, request);
  return resource;
}

/**
 * Check if a user is authorized.
 */
async function checkUser(id, request) {
  const authorization = request.get('Authorization');
  if (!authorization) throw new Error('Authorization is required.');

  const user = await app.adapter.find('user', id);
  const tokens = await app.adapter.findMany('token', user.links.tokens);
  const tokenFound = tokens.some(function (token) {
    return token.value == authorization;
  });

  if (!tokenFound) throw new Error('Token is not valid.');
  return user;
}
