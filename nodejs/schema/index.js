const { GraphQLSchema, GraphQLObjectType, execute: graphqlExecute, getOperationAST, Kind } = require('graphql');
const { createHandler } = require('graphql-http/lib/use/express');
const permissions = require('../permissions');

// [FRAMEWORK]
const componentResolvers = require('./resolvers/framework/components');
const surveyResolvers    = require('./resolvers/framework/survey');
const userResolvers      = require('./resolvers/framework/users');
const roleResolvers      = require('./resolvers/framework/roles');

const Query = new GraphQLObjectType({
  name: 'Query',
  fields: {
    ...componentResolvers.queries,
    ...surveyResolvers.queries,
    ...userResolvers.queries,
    ...roleResolvers.queries,
  },
});

const Mutation = new GraphQLObjectType({
  name: 'Mutation',
  fields: {
    ...componentResolvers.mutations,
    ...surveyResolvers.mutations,
    ...userResolvers.mutations,
    ...roleResolvers.mutations,
  },
});

const schema = new GraphQLSchema({ query: Query, mutation: Mutation });

// Every top-level field name of the operation that will actually execute —
// resolved via getOperationAST (not definitions[0], which may be a fragment)
// and with fragment spreads / inline fragments at the top level expanded.
// Returns null when anything can't be resolved; callers must treat null as
// deny (fail closed). A GraphQL document executes ALL top-level selections,
// so the gate must enforce all of them — checking only the first would let a
// privileged field ride in batched behind an allowed one.
function topLevelFieldNames(document, operationName) {
  const operation = getOperationAST(document, operationName ?? undefined);
  if (!operation) return null;
  const fragments = new Map(
    document.definitions
      .filter((d) => d.kind === Kind.FRAGMENT_DEFINITION)
      .map((d) => [d.name.value, d])
  );
  const names = new Set();
  const expanded = new Set(); // guards against fragment spread cycles
  const walk = (selectionSet) => {
    for (const sel of selectionSet.selections) {
      if (sel.kind === Kind.FIELD) {
        names.add(sel.name.value); // real field name — aliases live in sel.alias
      } else if (sel.kind === Kind.INLINE_FRAGMENT) {
        if (!walk(sel.selectionSet)) return false;
      } else if (sel.kind === Kind.FRAGMENT_SPREAD) {
        if (expanded.has(sel.name.value)) continue;
        expanded.add(sel.name.value);
        const frag = fragments.get(sel.name.value);
        if (!frag || !walk(frag.selectionSet)) return false;
      } else {
        return false;
      }
    }
    return true;
  };
  return walk(operation.selectionSet) ? names : null;
}

const handler = createHandler({
  schema,
  context: (req) => ({ user: req.raw?.user ?? null }),
  execute: async (args) => {
    const { document, operationName, contextValue } = args;
    const user = contextValue?.user;

    const names = topLevelFieldNames(document, operationName);
    if (!names || names.size === 0) {
      return { errors: [{ message: 'Unable to resolve operation' }] };
    }

    // Same rule for queries and mutations, applied to EVERY top-level field.
    // The `public` list (componentByName only — see permissions.js) is the
    // single anonymous escape hatch; every other GraphQL operation requires a
    // valid JWT. Then: registered list → any JWT, user list → tier user/admin,
    // everything else → admin. Checks use the JWT's `tier` claim — the
    // roles-table tier resolved at login (backend.js normalises legacy
    // tokens), so any role aliased onto a tier passes its rung.
    for (const name of names) {
      if (permissions.public.includes(name)) continue;
      if (!user) return { errors: [{ message: 'Authentication required' }] };
      if (permissions.user.includes(name)) {
        if (user.tier !== 'user' && user.tier !== 'admin') {
          return { errors: [{ message: 'User access required' }] };
        }
      } else if (!permissions.registered.includes(name)) {
        if (user.tier !== 'admin') return { errors: [{ message: 'Admin access required' }] };
      }
    }
    return graphqlExecute(args);
  },
});

module.exports = { schema, handler };
