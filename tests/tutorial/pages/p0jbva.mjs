// The tutorial map, P0JBVA, as page 1 makes it: its seed and its five land masks, the outline
// points a reader clicks. The tutorial is where P0JBVA comes from: the test fixture
// (tests/mesh/fixtures/p0jbva.json) is the map at the end of page 4, copied there by the build.

export const SEED = "P0JBVA";

/** The land masks in the order they are drawn: the continent, three islands, the inland sea. */
export const MASKS = [
    { name: "Landmass 1", land: true, points: [[-51, -20], [-55, 471], [34, 542], [157, 672], [222, 757], [300, 797], [427, 684], [518, 693], [564, 755], [417, 839], [426, 914], [502, 961], [559, 1087], [658, 1234], [719, 1444], [716, 1626], [1384, 1627], [1146, 1507], [1252, 1439], [1200, 1330], [1279, 1341], [1331, 1106], [1318, 1048], [1237, 1028], [1389, 769], [1359, 683], [1437, 529], [1309, 434], [1394, 424], [1465, 364], [1579, 403], [1625, 371], [1617, 269], [1740, 230], [1871, 283], [1897, 337], [2012, 362], [2026, -16]] },
    { name: "Landmass 2", land: true, points: [[1598, 1247], [1530, 1245], [1517, 1167], [1470, 1114], [1447, 1073], [1475, 1015], [1568, 954], [1660, 997], [1659, 1065], [1616, 1094], [1657, 1129], [1651, 1169]] },
    { name: "Landmass 3", land: true, points: [[2022, 489], [1915, 510], [1784, 535], [1690, 646], [1783, 717], [1888, 728], [1957, 755], [2024, 724]] },
    { name: "Landmass 4", land: true, points: [[2024, 1310], [1958, 1324], [1890, 1314], [1847, 1313], [1827, 1372], [1839, 1432], [1907, 1500], [1925, 1550], [2010, 1566]] },
    { name: "Ocean Hole 5", land: false, points: [[1004, 784], [1066, 804], [1111, 849], [1063, 933], [1013, 950], [964, 925], [952, 860]] },
];
