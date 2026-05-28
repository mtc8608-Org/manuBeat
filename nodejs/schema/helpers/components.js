const { pool } = require('../../db');

async function fetchChildren(parent) {
  const query = `
    SELECT c.*
    FROM components_relationships cr
    JOIN components c ON cr.child_id = c.id
    WHERE cr.parent_id = $1::uuid
    ORDER BY cr.position ASC
  `;
  try {
    const res = await pool.query(query, [parent.id]);
    return res.rows;
  } catch (error) {
    console.error(error);
    throw new Error('Error fetching children');
  }
}

const postComponent = async (name, type, data, options, children) => {
  const query = 'INSERT INTO components (name, type, data, options) VALUES ($1::text, $2::text, $3::json, $4::json) RETURNING *';
  try {
    console.log('-> Tying to Post component by id:', name, ' type:', type);
    const res = await pool.query(query, [name, type, data, options]);
    console.log('-> Post component by id:', res.rows[0].id, ' type:', type);

    if (children) {
      for (let child of children) {
        console.log('-> Tying to Post child component by id:', child.name, ' type:', child.type);
        const childRes = await postComponent(child.name, child.type, child.data, child.options, child.children);
        console.log('-> Post child component by id:', childRes.id, ' type:', child.type);
        console.log('-> Tying to Relate components:', res.rows[0].id, ' and ', childRes.id);
        await relateComponents(res.rows[0].id, childRes.id);
        console.log('-> Relate components:', res.rows[0].id, ' and ', childRes.id);
      }
    }

    return res.rows[0];
  } catch (error) {
    console.error(error);
    throw new Error('Error creating component');
  }
};

const updateComponent = async (id, name, type, data, options) => {
  const query = 'UPDATE components SET name = $1::text, type = $2::text, data = $3::json, options = $4::json WHERE id = $5::uuid RETURNING *';
  try {
    const res = await pool.query(query, [name, type, data, options, id]);
    return res.rows[0];
  } catch (error) {
    console.error(error);
    throw new Error('Error updating component');
  }
};

const deleteComponent = async (id) => {
  const query = 'DELETE FROM components WHERE id = $1::uuid';
  try {
    await pool.query(query, [id]);
    return true;
  } catch (error) {
    console.error(error);
    throw new Error('Error deleting component');
  }
};

const deleteComponentRelation = async (parent_id, child_id) => {
  const query = 'DELETE FROM components_relationships WHERE parent_id = $1::uuid AND child_id = $2::uuid';
  try {
    await pool.query(query, [parent_id, child_id]);
    return true;
  } catch (error) {
    console.error(error);
    throw new Error('Error deleting component relation');
  }
};

const relateComponents = async (parentId, childId) => {
  const query = `
    INSERT INTO components_relationships (parent_id, child_id, position)
    VALUES ($1::uuid, $2::uuid,
      (SELECT COALESCE(MAX(position) + 1, 0) FROM components_relationships WHERE parent_id = $1::uuid))
  `;
  try {
    await pool.query(query, [parentId, childId]);
    return true;
  } catch (error) {
    console.error(error);
    throw new Error('Error relating components');
  }
};

module.exports = { fetchChildren, postComponent, updateComponent, deleteComponent, deleteComponentRelation, relateComponents };
