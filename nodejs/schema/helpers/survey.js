const { pool } = require('../../db');

async function fetchSurveyChildren(parent) {
  const query = `
    SELECT sc.*
    FROM survey_components_relationships scr
    JOIN survey_components sc ON scr.child_id = sc.id
    WHERE scr.parent_id = $1::uuid
    ORDER BY scr.position ASC
  `;
  try {
    const res = await pool.query(query, [parent.id]);
    return res.rows;
  } catch (error) {
    console.error(error);
    throw new Error('Error fetching survey children');
  }
}

async function postSurveyComponent(name, type, data, options, children) {
  const query = `INSERT INTO survey_components (name, type, data, options)
                 VALUES ($1::text, $2::text, $3::json, $4::json) RETURNING *`;
  try {
    const res = await pool.query(query, [name, type, data, options]);
    const parentId = res.rows[0].id;
    if (children) {
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const childRes = await postSurveyComponent(child.name, child.type, child.data, child.options, child.children);
        await pool.query(
          'INSERT INTO survey_components_relationships (parent_id, child_id, position) VALUES ($1::uuid, $2::uuid, $3)',
          [parentId, childRes.id, i + 1]
        );
      }
    }
    return res.rows[0];
  } catch (error) {
    console.error(error);
    throw new Error('Error creating survey component');
  }
}

module.exports = { fetchSurveyChildren, postSurveyComponent };
