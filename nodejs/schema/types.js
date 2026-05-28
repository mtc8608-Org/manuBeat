const {
  GraphQLObjectType,
  GraphQLID,
  GraphQLString,
  GraphQLInt,
  GraphQLFloat,
  GraphQLList,
  GraphQLBoolean,
  GraphQLScalarType,
  GraphQLNonNull,
  GraphQLInputObjectType,
} = require('graphql');
const { pool } = require('../db');
const { fetchChildren } = require('./helpers/components');
const { fetchSurveyChildren } = require('./helpers/survey');

const GraphQLJSON = new GraphQLScalarType({
  name: 'JSON',
  description: 'JSON custom scalar type',
  parseValue: value => value,
  serialize: value => value,
  parseLiteral: ast => ast,
});

const PriceType = new GraphQLObjectType({
  name: 'Price',
  fields: () => ({
    date:      { type: GraphQLString },
    open:      { type: GraphQLFloat },
    high:      { type: GraphQLFloat },
    low:       { type: GraphQLFloat },
    close:     { type: GraphQLFloat },
    adj_close: { type: GraphQLFloat },
    volume:    { type: GraphQLString },
  }),
});

const DefiProtocolType = new GraphQLObjectType({
  name: 'DefiProtocol',
  fields: () => ({
    id:          { type: GraphQLID },
    name:        { type: GraphQLString },
    slug:        { type: GraphQLString },
    type:        { type: GraphQLString },
    chains:      { type: new GraphQLList(GraphQLString) },
    description: { type: GraphQLString },
    config:      { type: GraphQLJSON },
    created_at:  { type: GraphQLString },
  }),
});

const AssetType = new GraphQLObjectType({
  name: 'Asset',
  fields: () => ({
    id:               { type: GraphQLID },
    ticker:           { type: GraphQLString },
    name:             { type: GraphQLString },
    asset_type:       { type: GraphQLString },
    exchange:         { type: GraphQLString },
    currency:         { type: GraphQLString },
    sector:           { type: GraphQLString },
    country:          { type: GraphQLString },
    is_active:        { type: GraphQLBoolean },
    contract_address: { type: GraphQLString },
    chain:            { type: GraphQLString },
    coingecko_id:     { type: GraphQLString },
    decimals:         { type: GraphQLInt },
    alias:            { type: GraphQLString },
    description:      { type: GraphQLString },
    protocol_id:      { type: GraphQLID },
    protocol: {
      type: DefiProtocolType,
      async resolve(parent) {
        if (!parent.protocol_id) return null;
        const r = await pool.query('SELECT * FROM defi_protocols WHERE id = $1', [parent.protocol_id]);
        return r.rows[0] || null;
      },
    },
    created_at:  { type: GraphQLString },
    updated_at:  { type: GraphQLString },
  }),
});

const WalletType = new GraphQLObjectType({
  name: 'Wallet',
  fields: () => ({
    id:         { type: GraphQLID },
    address:    { type: GraphQLString },
    chain:      { type: GraphQLString },
    label:      { type: GraphQLString },
    is_active:  { type: GraphQLBoolean },
    created_at: { type: GraphQLString },
  }),
});

const WalletTransferType = new GraphQLObjectType({
  name: 'WalletTransfer',
  fields: () => ({
    id:            { type: GraphQLID },
    wallet_id:     { type: GraphQLID },
    tx_hash:       { type: GraphQLString },
    log_index:     { type: GraphQLInt },
    block_number:  { type: GraphQLString },
    timestamp:     { type: GraphQLString },
    from_address:  { type: GraphQLString },
    to_address:    { type: GraphQLString },
    token_address: { type: GraphQLString },
    asset_id:      { type: GraphQLID },
    symbol:        { type: GraphQLString },
    raw_amount:    { type: GraphQLString },
    amount:        { type: GraphQLString },
    direction:     { type: GraphQLString },
    transfer_type: { type: GraphQLString },
    gas_fee_eth:   { type: GraphQLString },
    chain:         { type: GraphQLString },
  }),
});

const PlotType = new GraphQLObjectType({
  name: 'Plot',
  fields: () => ({
    id:         { type: GraphQLID },
    name:       { type: GraphQLString },
    config:     { type: GraphQLJSON },
    created_at: { type: GraphQLString },
    updated_at: { type: GraphQLString },
  }),
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
  PriceType,
  DefiProtocolType,
  AssetType,
  WalletType,
  WalletTransferType,
  PlotType,
  SurveyType,
  SurveyAnswerType,
  SurveyComponentType,
  SurveyComponentInputType,
  ComponentRelationType,
  ComponentType,
  ComponentInputType,
  UserType,
};
