const { Sequelize } = require('sequelize');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

// Usa la URL de la base de datos desde la variable de entorno DATABASE_URL
const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'mysql',
  logging: false,
  define: {
    freezeTableName: true
  }
});

module.exports = sequelize;