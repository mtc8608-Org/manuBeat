// AdminRoute — a route that only admins can reach.
// - Not logged in → redirected to sign-in
// - Logged in but not admin → redirected to the landing page
// - Admin → renders the protected page normally
//
// A thin alias for TierRoute's top rung, kept because admin-only is the common
// case and reads better at the call site. Any other rung uses TierRoute directly
// with minTier.
import React from 'react';
import { RouteProps } from 'react-router-dom';
import TierRoute from './TierRoute';

const AdminRoute: React.FC<RouteProps & { component: React.FC }> = (props) => (
  <TierRoute {...props} minTier="admin" />
);

export default AdminRoute;
