function withSchemaVersion(payload) {
  return {
    ...payload,
    schemaVersion: "1.0",
  };
}

module.exports = {
  withSchemaVersion,
};
