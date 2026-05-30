const {
  GraphQLObjectType,
  GraphQLID,
  GraphQLString,
  GraphQLList,
  GraphQLBoolean,
  GraphQLScalarType,
  GraphQLNonNull,
  GraphQLInputObjectType,
} = require('graphql');
const { fetchChildren } = require('./helpers/components');
const { fetchSurveyChildren } = require('./helpers/survey');

const GraphQLJSON = new GraphQLScalarType({
  name: 'JSON',
  description: 'JSON custom scalar type',
  parseValue: value => value,
  serialize: value => value,
  parseLiteral: ast => ast,
});

const SurveyType = new GraphQLObjectType({
  name: 'Survey',
  fields: () => ({
    id:           { type: GraphQLID },
    component_id: { type: GraphQLID },
    title:        { type: GraphQLString },
    is_active:    { type: GraphQLBoolean },
    created_at:   { type: GraphQLString },
  }),
});

const SurveyAnswerType = new GraphQLObjectType({
  name: 'SurveyAnswer',
  fields: () => ({
    id:           { type: GraphQLID },
    survey_id:    { type: GraphQLID },
    answers:      { type: GraphQLJSON },
    submitted_at: { type: GraphQLString },
  }),
});

const SurveyComponentType = new GraphQLObjectType({
  name: 'SurveyComponent',
  fields: () => ({
    id:       { type: GraphQLID },
    name:     { type: GraphQLString },
    type:     { type: GraphQLString },
    data:     { type: GraphQLJSON },
    options:  { type: GraphQLJSON },
    children: {
      type: new GraphQLList(SurveyComponentType),
      resolve: (parent) => fetchSurveyChildren(parent),
    },
  }),
});

const SurveyComponentInputType = new GraphQLInputObjectType({
  name: 'SurveyComponentInput',
  fields: () => ({
    name:     { type: new GraphQLNonNull(GraphQLString) },
    type:     { type: GraphQLString },
    data:     { type: GraphQLJSON },
    options:  { type: GraphQLJSON },
    children: { type: new GraphQLList(SurveyComponentInputType) },
  }),
});

const ComponentRelationType = new GraphQLObjectType({
  name: 'Relation',
  fields: () => ({
    parent_name: { type: GraphQLString },
    parent_id:   { type: GraphQLID },
    child_name:  { type: GraphQLString },
    child_id:    { type: GraphQLID },
  }),
});

const ComponentType = new GraphQLObjectType({
  name: 'Component',
  fields: () => ({
    id:      { type: GraphQLID },
    name:    { type: GraphQLString },
    type:    { type: GraphQLString },
    data:    { type: GraphQLJSON },
    options: { type: GraphQLJSON },
    children: {
      type: new GraphQLList(ComponentType),
      async resolve(parent) {
        return fetchChildren(parent);
      },
    },
  }),
});

const ComponentInputType = new GraphQLInputObjectType({
  name: 'ComponentInput',
  fields: () => ({
    name:     { type: new GraphQLNonNull(GraphQLString) },
    type:     { type: GraphQLString },
    data:     { type: GraphQLJSON },
    options:  { type: GraphQLJSON },
    children: { type: new GraphQLList(ComponentInputType) },
  }),
});

const UserType = new GraphQLObjectType({
  name: 'User',
  fields: () => ({
    id:         { type: GraphQLID },
    email:      { type: GraphQLString },
    role:       { type: GraphQLString },
    is_active:  { type: GraphQLBoolean },
    created_at: { type: GraphQLString },
  }),
});

module.exports = {
  GraphQLJSON,
  SurveyType,
  SurveyAnswerType,
  SurveyComponentType,
  SurveyComponentInputType,
  ComponentRelationType,
  ComponentType,
  ComponentInputType,
  UserType,
};
