import type { AnyCircuitElement } from "circuit-json"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { fillCircleWithRects } from "./fillCircleWithRects"
import { fillPolygonWithRects } from "./fillPolygonWithRects"
import type { RotatedRect } from "./generateApproximatingRects"
import { getObstaclesFromRoute } from "./getObstaclesFromRoute"
import type { Obstacle } from "./types"

const EVERY_LAYER = ["top", "inner1", "inner2", "bottom"]
const QUARTER_TURN_TOLERANCE_DEGREES = 0.01

const expandKeepoutLayers = (layers: string[]): string[] => {
  if (layers.some((layer) => layer === "all" || layer === "multilayer")) {
    return EVERY_LAYER
  }
  return layers
}

const rotatePadLocalPoint = (
  point: { x: number; y: number },
  center: { x: number; y: number },
  rotationDeg: number,
): { x: number; y: number } => {
  const angleRad = (rotationDeg * Math.PI) / 180
  const cosAngle = Math.cos(angleRad)
  const sinAngle = Math.sin(angleRad)
  return {
    x: center.x + point.x * cosAngle - point.y * sinAngle,
    y: center.y + point.x * sinAngle + point.y * cosAngle,
  }
}

type KeepoutOutlineElement = {
  type: "pcb_keepout"
  shape: "outline"
  outline: { x: number; y: number }[]
  stroke_width: number
  layers: string[]
  pcb_component_id?: string
}

const asKeepoutOutline = (
  element: AnyCircuitElement,
): KeepoutOutlineElement | null => {
  if (element.type !== "pcb_keepout") return null
  const maybe = element as unknown as KeepoutOutlineElement
  if (maybe.shape !== "outline" || !Array.isArray(maybe.outline)) return null
  return maybe
}

const getAxisAlignedRectFromRotatedRect = (
  rotatedRect: RotatedRect,
): {
  center: { x: number; y: number }
  width: number
  height: number
} | null => {
  const normalizedRotation = ((rotatedRect.rotation % 360) + 360) % 360
  const axisAlignedAngles = [0, 90, 180, 270] as const

  for (const angle of axisAlignedAngles) {
    const angularDistance = Math.min(
      Math.abs(normalizedRotation - angle),
      360 - Math.abs(normalizedRotation - angle),
    )

    if (angularDistance > QUARTER_TURN_TOLERANCE_DEGREES) continue

    const isVertical = angle === 90 || angle === 270

    return {
      center: rotatedRect.center,
      width: isVertical ? rotatedRect.height : rotatedRect.width,
      height: isVertical ? rotatedRect.width : rotatedRect.height,
    }
  }

  return null
}

export const getObstaclesFromCircuitJson = (
  circuitJson: AnyCircuitElement[],
  connMap?: ConnectivityMap,
) => {
  const withNetId = (idList: string[]) =>
    connMap
      ? idList.concat(
          idList
            .map((id) => connMap.getNetConnectedToId(id))
            .filter((id): id is string => Boolean(id)),
        )
      : idList
  const obstacles: Obstacle[] = []
  for (const element of circuitJson) {
    const pcbComponentId =
      "pcb_component_id" in element ? element.pcb_component_id : undefined

    if (element.type === "pcb_smtpad") {
      if (element.shape === "circle") {
        obstacles.push({
          componentId: pcbComponentId,
          type: "oval",
          layers: [element.layer],
          center: {
            x: element.x,
            y: element.y,
          },
          width: element.radius * 2,
          height: element.radius * 2,
          connectedTo: withNetId([element.pcb_smtpad_id]),
        })
      } else if (element.shape === "rect") {
        obstacles.push({
          componentId: pcbComponentId,
          type: "rect",
          layers: [element.layer],
          center: {
            x: element.x,
            y: element.y,
          },
          width: element.width,
          height: element.height,
          connectedTo: withNetId([element.pcb_smtpad_id]),
        })
      } else if (element.shape === "rotated_rect") {
        const rotatedRect: RotatedRect = {
          center: { x: element.x, y: element.y },
          width: element.width,
          height: element.height,
          rotation: element.ccw_rotation,
        }
        const axisAlignedRect = getAxisAlignedRectFromRotatedRect(rotatedRect)
        const rect = axisAlignedRect ?? rotatedRect

        obstacles.push({
          componentId: pcbComponentId,
          type: "rect",
          layers: [element.layer],
          center: rect.center,
          width: rect.width,
          height: rect.height,
          ccwRotationDegrees: element.ccw_rotation,
          connectedTo: withNetId([element.pcb_smtpad_id]),
        })
      } else if (element.shape === "pill" || element.shape === "rotated_pill") {
        obstacles.push({
          componentId: pcbComponentId,
          type: "rect",
          layers: [element.layer],
          center: {
            x: element.x,
            y: element.y,
          },
          width: element.width,
          height: element.height,
          ...(element.shape === "rotated_pill"
            ? { ccwRotationDegrees: element.ccw_rotation }
            : {}),
          connectedTo: withNetId([element.pcb_smtpad_id]),
        })
      } else if (element.shape === "polygon") {
        const xs = element.points.map((point) => point.x)
        const ys = element.points.map((point) => point.y)
        const minX = Math.min(...xs)
        const maxX = Math.max(...xs)
        const minY = Math.min(...ys)
        const maxY = Math.max(...ys)

        obstacles.push({
          componentId: pcbComponentId,
          type: "rect",
          layers: [element.layer],
          center: {
            x: (minX + maxX) / 2,
            y: (minY + maxY) / 2,
          },
          width: maxX - minX,
          height: maxY - minY,
          connectedTo: withNetId([element.pcb_smtpad_id]),
        })
      }
    } else if (element.type === "pcb_keepout") {
      const keepoutLayers = expandKeepoutLayers(element.layers)
      const outlineKeepout = asKeepoutOutline(element)
      if (outlineKeepout) {
        if (outlineKeepout.outline.length >= 3) {
          const approximatingRects = fillPolygonWithRects(
            outlineKeepout.outline,
            {
              rectHeight: 0.6,
            },
          )

          for (const rect of approximatingRects) {
            obstacles.push({
              componentId: pcbComponentId,
              type: "rect",
              layers: keepoutLayers,
              center: rect.center,
              width: rect.width,
              height: rect.height,
              connectedTo: [],
            })
          }
        } else if (outlineKeepout.outline.length === 2) {
          const [start, end] = outlineKeepout.outline
          if (!start || !end) continue
          const dx = end.x - start.x
          const dy = end.y - start.y
          const length = Math.hypot(dx, dy)
          if (length <= 1e-9) continue
          obstacles.push({
            componentId: pcbComponentId,
            type: "rect",
            layers: keepoutLayers,
            center: {
              x: (start.x + end.x) / 2,
              y: (start.y + end.y) / 2,
            },
            width: length,
            height: outlineKeepout.stroke_width,
            ccwRotationDegrees: (Math.atan2(dy, dx) * 180) / Math.PI,
            connectedTo: [],
          })
        }
      } else if (element.shape === "circle") {
        obstacles.push({
          componentId: pcbComponentId,
          type: "oval",
          layers: keepoutLayers,
          center: {
            x: element.center.x,
            y: element.center.y,
          },
          width: element.radius * 2,
          height: element.radius * 2,
          connectedTo: [],
        })
      } else if (element.shape === "rect") {
        obstacles.push({
          componentId: pcbComponentId,
          type: "rect",
          layers: keepoutLayers,
          center: {
            x: element.center.x,
            y: element.center.y,
          },
          width: element.width,
          height: element.height,
          connectedTo: [],
        })
      }
    } else if (element.type === "pcb_cutout") {
      if (element.shape === "rect") {
        obstacles.push({
          componentId: pcbComponentId,
          type: "rect",
          layers: EVERY_LAYER,
          center: {
            x: element.center.x,
            y: element.center.y,
          },
          width: element.width,
          height: element.height,
          connectedTo: [],
        })
      } else if (element.shape === "circle") {
        const approximatingRects = fillCircleWithRects(
          {
            center: element.center,
            radius: element.radius,
          },
          { rectHeight: 0.6 },
        )

        for (const rect of approximatingRects) {
          obstacles.push({
            componentId: pcbComponentId,
            type: "rect",
            layers: EVERY_LAYER,
            center: rect.center,
            width: rect.width,
            height: rect.height,
            connectedTo: [],
          })
        }
      } else if (element.shape === "polygon") {
        const approximatingRects = fillPolygonWithRects(element.points, {
          rectHeight: 0.6,
        })

        for (const rect of approximatingRects) {
          obstacles.push({
            componentId: pcbComponentId,
            type: "rect",
            layers: EVERY_LAYER,
            center: rect.center,
            width: rect.width,
            height: rect.height,
            connectedTo: [],
          })
        }
      }
    } else if (element.type === "pcb_hole") {
      if (element.hole_shape === "oval") {
        obstacles.push({
          componentId: pcbComponentId,
          type: "oval",
          layers: EVERY_LAYER,
          center: {
            x: element.x,
            y: element.y,
          },
          width: element.hole_width,
          height: element.hole_height,
          connectedTo: [],
        })
      } else if (
        element.hole_shape === "pill" ||
        element.hole_shape === "rotated_pill"
      ) {
        obstacles.push({
          componentId: pcbComponentId,
          type: "rect",
          layers: EVERY_LAYER,
          center: {
            x: element.x,
            y: element.y,
          },
          width: element.hole_width,
          height: element.hole_height,
          ...(element.hole_shape === "rotated_pill"
            ? { ccwRotationDegrees: element.ccw_rotation }
            : {}),
          connectedTo: [],
        })
      } else if (element.hole_shape === "rect") {
        obstacles.push({
          componentId: pcbComponentId,
          type: "rect",
          layers: EVERY_LAYER,
          center: {
            x: element.x,
            y: element.y,
          },
          width: element.hole_width,
          height: element.hole_height,
          connectedTo: [],
        })
      } else if (element.hole_shape === "square") {
        obstacles.push({
          componentId: pcbComponentId,
          type: "rect",
          layers: EVERY_LAYER,
          center: {
            x: element.x,
            y: element.y,
          },
          width: element.hole_diameter,
          height: element.hole_diameter,
          connectedTo: [],
        })
      } else if (
        (element.hole_shape as string) === "round" ||
        element.hole_shape === "circle"
      ) {
        obstacles.push({
          componentId: pcbComponentId,
          type: "rect",
          layers: EVERY_LAYER,
          center: {
            x: element.x,
            y: element.y,
          },
          width: element.hole_diameter,
          height: element.hole_diameter,
          connectedTo: [],
        })
      }
    } else if (element.type === "pcb_plated_hole") {
      if (element.shape === "circle") {
        obstacles.push({
          componentId: pcbComponentId,
          type: "oval",
          layers: EVERY_LAYER,
          center: {
            x: element.x,
            y: element.y,
          },
          width: element.outer_diameter,
          height: element.outer_diameter,
          connectedTo: withNetId([element.pcb_plated_hole_id]),
        })
      } else if (element.shape === "circular_hole_with_rect_pad") {
        obstacles.push({
          componentId: pcbComponentId,
          type: "rect",
          layers: EVERY_LAYER,
          center: {
            x: element.x,
            y: element.y,
          },
          width: element.rect_pad_width,
          height: element.rect_pad_height,
          connectedTo: withNetId([element.pcb_plated_hole_id]),
        })
      } else if (element.shape === "oval") {
        obstacles.push({
          componentId: pcbComponentId,
          type: "oval",
          layers: EVERY_LAYER,
          center: {
            x: element.x,
            y: element.y,
          },
          width: element.outer_width,
          height: element.outer_height,
          connectedTo: withNetId([element.pcb_plated_hole_id]),
        })
      } else if (element.shape === "pill") {
        obstacles.push({
          componentId: pcbComponentId,
          type: "rect",
          layers: EVERY_LAYER,
          center: {
            x: element.x,
            y: element.y,
          },
          width: element.outer_width,
          height: element.outer_height,
          ccwRotationDegrees: element.ccw_rotation,
          connectedTo: withNetId([element.pcb_plated_hole_id]),
        })
      } else if (element.shape === "hole_with_polygon_pad") {
        // pad_outline is pad-local; rotate about the hole center like copper-pour-solver
        if (
          "pad_outline" in element &&
          element.pad_outline &&
          element.pad_outline.length > 0
        ) {
          const rotationDeg =
            "ccw_rotation" in element ? (element.ccw_rotation ?? 0) : 0
          const worldPoints = element.pad_outline.map((point) =>
            rotatePadLocalPoint(
              point,
              { x: element.x, y: element.y },
              rotationDeg,
            ),
          )
          const xs = worldPoints.map((p) => p.x)
          const ys = worldPoints.map((p) => p.y)
          const minX = Math.min(...xs)
          const maxX = Math.max(...xs)
          const minY = Math.min(...ys)
          const maxY = Math.max(...ys)
          const centerX = (minX + maxX) / 2
          const centerY = (minY + maxY) / 2
          obstacles.push({
            componentId: pcbComponentId,
            type: "rect",
            layers: EVERY_LAYER,
            center: {
              x: centerX,
              y: centerY,
            },
            width: maxX - minX,
            height: maxY - minY,
            connectedTo: withNetId([element.pcb_plated_hole_id]),
          })
        }
      }
    } else if (element.type === "pcb_trace") {
      const traceObstacles = getObstaclesFromRoute(
        element.route.flatMap((rp) => {
          if (rp.route_type === "through_pad") {
            return [
              {
                x: rp.start.x,
                y: rp.start.y,
                layer: rp.start_layer,
              },
              {
                x: rp.end.x,
                y: rp.end.y,
                layer: rp.end_layer,
              },
            ]
          }

          return [
            {
              x: rp.x,
              y: rp.y,
              layer: rp.route_type === "wire" ? rp.layer : rp.from_layer,
            },
          ]
        }),
        element.source_trace_id!,
      )
      obstacles.push(
        ...traceObstacles.map((obstacle) => ({
          ...obstacle,
          componentId: pcbComponentId,
        })),
      )
    } else if (element.type === "pcb_via") {
      const netIsAssignable = Boolean(
        (element as any).net_is_assignable ?? (element as any).netIsAssignable,
      )
      obstacles.push({
        componentId: pcbComponentId,
        type: "rect",
        layers: element.layers,
        center: {
          x: element.x,
          y: element.y,
        },
        connectedTo: withNetId([element.pcb_via_id]),
        width: element.outer_diameter,
        height: element.outer_diameter,
        netIsAssignable: netIsAssignable || undefined,
      })
    }
  }
  return obstacles
}
