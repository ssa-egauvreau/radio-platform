import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildTen8IncidentSeedCoords,
  formatTen8Coordinates,
  formatTen8Latlng,
  parseTen8CoordinateString,
} from "../../src/ten8/geocode.js";

test("formatTen8Coordinates matches New Incident API example shape", () => {
  assert.equal(formatTen8Coordinates(33.79990119110902, -117.88240038784782), "(33.79990119110902, -117.88240038784782)");
});

test("formatTen8Latlng matches CAD v1.1.0 create example shape", () => {
  assert.equal(formatTen8Latlng(33.717, -117.831), "33.717, -117.831");
});

test("parseTen8CoordinateString parses parenthesized coordinates", () => {
  const got = parseTen8CoordinateString("(33.79990119110902, -117.88240038784782)");
  assert.deepEqual(got, { lat: 33.79990119110902, lon: -117.88240038784782 });
});

test("parseTen8CoordinateString parses comma-separated latlng", () => {
  assert.deepEqual(parseTen8CoordinateString("33.717, -117.831"), { lat: 33.717, lon: -117.831 });
});

test("parseTen8CoordinateString returns null for invalid input", () => {
  assert.equal(parseTen8CoordinateString(""), null);
  assert.equal(parseTen8CoordinateString("not coords"), null);
  assert.equal(parseTen8CoordinateString(null), null);
});

test("buildTen8IncidentSeedCoords copies coordinates and numeric lat/lng fields", () => {
  const coords = formatTen8Coordinates(33.75, -117.88);
  const got = buildTen8IncidentSeedCoords({ coordinates: coords, location: "1 Main St" });
  assert.equal(got.coordinates, coords);
  assert.equal(got.lat, 33.75);
  assert.equal(got.lng, -117.88);
  assert.equal(got.latitude, 33.75);
  assert.equal(got.longitude, -117.88);
});

test("buildTen8IncidentSeedCoords returns empty when coordinates missing", () => {
  assert.deepEqual(buildTen8IncidentSeedCoords({ location: "1 Main St" }), {});
});
