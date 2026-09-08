import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { getObstaclesFromCircuitJson } from "lib/obstacles/getObstaclesFromCircuitJson"

test("pcb_keepout outline fills the enclosed region as routing obstacles", () => {
  const obstacles = getObstaclesFromCircuitJson([
    {
      type: "pcb_keepout",
      pcb_keepout_id: "pcb_keepout_1",
      shape: "outline",
      outline: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 2 },
        { x: 0, y: 2 },
      ],
      stroke_width: 0.2,
      layers: ["top"],
    },
  ] as unknown as AnyCircuitElement[])

  expect(obstacles.length).toBeGreaterThan(0)
  expect(obstacles.every((obstacle) => obstacle.connectedTo.length === 0)).toBe(
    true,
  )
  expect(obstacles.every((obstacle) => obstacle.layers.includes("top"))).toBe(
    true,
  )

  const coversInterior = obstacles.some((obstacle) => {
    const halfWidth = obstacle.width / 2
    const halfHeight = obstacle.height / 2
    return (
      2 >= obstacle.center.x - halfWidth &&
      2 <= obstacle.center.x + halfWidth &&
      1 >= obstacle.center.y - halfHeight &&
      1 <= obstacle.center.y + halfHeight
    )
  })
  expect(coversInterior).toBe(true)
})

test("pcb_keepout layers all expand to every copper layer", () => {
  const obstacles = getObstaclesFromCircuitJson([
    {
      type: "pcb_keepout",
      pcb_keepout_id: "pcb_keepout_all",
      shape: "rect",
      center: { x: 1, y: 1 },
      width: 2,
      height: 1,
      layers: ["all"],
    },
  ] as unknown as AnyCircuitElement[])

  expect(obstacles).toHaveLength(1)
  expect(obstacles[0]?.layers).toEqual(["top", "inner1", "inner2", "bottom"])
})

test("hole_with_polygon_pad rotates pad_outline by ccw_rotation", () => {
  const obstacles = getObstaclesFromCircuitJson([
    {
      type: "pcb_plated_hole",
      pcb_plated_hole_id: "poly_pad",
      shape: "hole_with_polygon_pad",
      hole_shape: "circle",
      hole_diameter: 0.6,
      x: 2,
      y: -1,
      ccw_rotation: 90,
      layers: ["top"],
      pad_outline: [
        { x: -1, y: -0.5 },
        { x: 1, y: -0.5 },
        { x: 1, y: 0.5 },
        { x: -1, y: 0.5 },
      ],
    },
  ] as unknown as AnyCircuitElement[])

  expect(obstacles).toHaveLength(1)
  // 2×1 local rect stood on end about (2, -1)
  expect(obstacles[0]?.center.x).toBeCloseTo(2, 5)
  expect(obstacles[0]?.center.y).toBeCloseTo(-1, 5)
  expect(obstacles[0]?.width).toBeCloseTo(1, 5)
  expect(obstacles[0]?.height).toBeCloseTo(2, 5)
})
