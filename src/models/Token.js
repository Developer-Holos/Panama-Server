const { DataTypes } = require('sequelize');
const sequelize = require('../db'); // Ajusta la ruta según tu configuración

const Token = sequelize.define('Token', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  domain: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  access_token: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  refresh_token: {
    type: DataTypes.TEXT,
    allowNull: false
  }
}, {
  tableName: 'kommo_tokens',
  timestamps: false
});

module.exports = Token;