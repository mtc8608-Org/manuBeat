const { GraphQLSchema, GraphQLObjectType, execute: graphqlExecute } = require('graphql');
const { createHandler } = require('graphql-http/lib/use/express');
const permissions = require('../permissions');

// [FRAMEWORK]
const componentResolvers = require('./resolvers/framework/components');
const surveyResolvers    = require('./resolvers/framework/survey');
const userResolvers      = require('./resolvers/framework/users');
// [MEDICAL]
const modelResolvers     = require('./resolvers/medical/models');

const Query = new GraphQLObjectType({
  name: 'Query',
  fields: {
    ...componentResolvers.queries,
    ...surveyResolvers.queries,
    ...userResolvers.queries,
    ...modelResolvers.queries,
  },
});

const Mutation = new GraphQLObjectType({
  name: 'Mutation',
  fields: {
    ...componentResolvers.mutations,
    ...surveyResolvers.mutations,
    ...modelResolvers.mutations,
  },
});

const schema = new GraphQLSchema({ query: Query, mutation: Mutation });

const handler = createHandler({
  schema,
  context: (req) => ({ user: req.raw?.user ?? null }),
  execute: async (args) => {
    const { document, contextValue } = args;
    const op   = document.definitions[0]?.operation;
    const name = document.definitions[0]?.selectionSet?.selections[0]?.name?.value ?? '';
    const user = contextValue?.user;

    if (op === 'mutation') {
      if (permissions.user.includes(name)) {
        if (!user) return { errors: [{ message: 'Authentication required' }] };
      } else if (!permissions.public.includes(name)) {
        if (user?.role !== 'admin') return { errors: [{ message: 'Admin access required' }] };
      }
    } else {
      if (permissions.user.includes(name) && !user) {
        return { errors: [{ message: 'Authentication required' }] };
      }
    }
    return graphqlExecute(args);
  },
});

module.exports = { schema, handler };
