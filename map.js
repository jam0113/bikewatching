// Step 1.1 and Step 3: import Mapbox GL JS and D3 as ES modules
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Check that Mapbox GL JS is loaded
console.log('Mapbox GL JS Loaded:', mapboxgl);

// Step 1.3: your Mapbox default public token (starts with "pk.")
mapboxgl.accessToken = 'pk.eyJ1IjoiamFtMTAwIiwiYSI6ImNtd2gwMW1lbTBlY3MyeHBub2hyYzJodngifQ.ZIJwK1ocH4NEwclUUsfAMw';

const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027], // [longitude, latitude], near MIT
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

// Step 2.3: one style object shared by the Boston and Cambridge bike lane layers
const bikeLaneStyle = {
  'line-color': '#32D400',
  'line-width': 3,
  'line-opacity': 0.5,
};

// Step 5.4: trips sorted into 1440 buckets, one per minute of the day
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

// Step 3.3: convert a station's lon/lat into pixel coordinates on the map.
// map.project() accounts for panning, zooming and rotation.
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

// Step 5.2: minutes since midnight -> "8:30 AM"
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

// Step 5.3: a Date -> minutes since midnight
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Step 5.4: trips within 60 minutes of the selected minute, read from the buckets.
// The % 1440 handles windows that cross midnight.
function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat(); // No filtering, return all trips
  }

  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;

  if (minMinute > maxMinute) {
    let beforeMidnight = tripsByMinute.slice(minMinute);
    let afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}

// Steps 4.2, 5.3, 5.4: arrivals, departures and total traffic for each station
function computeStationTraffic(stations, timeFilter = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter),
    (v) => v.length,
    (d) => d.start_station_id,
  );

  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter),
    (v) => v.length,
    (d) => d.end_station_id,
  );

  return stations.map((station) => {
    let id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

// Step 6.1: share of departures -> 0 (more arrivals), 0.5 (balanced) or 1 (more departures)
const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

// A station with no trips at the selected time counts as balanced
// (otherwise 0 / 0 = NaN and the circle would lose its color)
function departureRatio(d) {
  return d.totalTraffic ? stationFlow(d.departures / d.totalTraffic) : 0.5;
}

// Step 2.1: wait for the map to load before adding data
map.on('load', async () => {
  // Step 2.1: Boston bike lanes
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: bikeLaneStyle,
  });

  // Step 2.3: Cambridge bike lanes
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });

  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge_route',
    paint: bikeLaneStyle,
  });

  // Step 3.3: the SVG layer on top of the map
  const svg = d3.select('#map').select('svg');

  // Step 3.1: station information
  let jsonData;
  try {
    const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
    jsonData = await d3.json(jsonurl);
    console.log('Loaded JSON Data:', jsonData);
  } catch (error) {
    console.error('Error loading JSON:', error);
    return;
  }

  // Steps 4.1, 5.3, 5.4: trips, with dates parsed and each trip put in its minute bucket
  let trips = await d3.csv(
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
    (trip) => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);

      let startedMinutes = minutesSinceMidnight(trip.started_at);
      departuresByMinute[startedMinutes].push(trip);

      let endedMinutes = minutesSinceMidnight(trip.ended_at);
      arrivalsByMinute[endedMinutes].push(trip);

      return trip;
    },
  );
  console.log('Loaded trips:', trips.length);

  // Steps 4.2, 5.4: traffic over the whole day
  const stations = computeStationTraffic(jsonData.data.stations);
  console.log('Stations Array:', stations);

  // Step 4.3: square root scale, so circle AREA (not radius) matches traffic
  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

  // Steps 3.3, 4.3, 4.4, 5.3, 6.1: one circle per station, keyed by short_name
  const circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name)
    .enter()
    .append('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic))
    .style('--departure-ratio', departureRatio)
    .each(function (d) {
      // Step 4.4: browser tooltip with exact numbers
      d3.select(this)
        .append('title')
        .text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
        );
    });

  // Step 3.3: keep the circles lined up with the map
  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy);
  }

  updatePositions();

  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  // Step 5.2: slider and time display
  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  // Step 5.3: recompute traffic for the selected time and resize/recolor the circles
  function updateScatterPlot(timeFilter) {
    const filteredStations = computeStationTraffic(stations, timeFilter);

    // Fewer trips when filtering, so allow bigger circles
    timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);

    circles
      .data(filteredStations, (d) => d.short_name)
      .join('circle')
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .style('--departure-ratio', departureRatio)
      .select('title')
      .text(
        (d) =>
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
      );
  }

  function updateTimeDisplay() {
    let timeFilter = Number(timeSlider.value);

    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }

    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});
