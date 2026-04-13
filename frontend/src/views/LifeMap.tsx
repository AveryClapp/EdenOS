import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as d3 from 'd3'

interface Goal {
  id: string
  title: string
  tier: 'long' | 'mid'
  weight: number
  status: 'active' | 'paused' | 'done' | 'dropped'
  parent_id: string | null
  target_date: string
}

interface Project {
  id: string
  title: string
  goal_id: string
  status: 'active' | 'paused' | 'done' | 'dropped'
  priority_score: number
  category: string
}

interface TreeNode {
  id: string
  title: string
  type: 'root' | 'long' | 'mid' | 'project'
  status: string
  weight?: number
  priority?: number
  children?: TreeNode[]
}

const STATUS_COLOR: Record<string, string> = {
  active:  '#00badc',
  paused:  '#ffb300',
  done:    '#00cc6a',
  dropped: '#316a86',
}

const TYPE_LABEL: Record<string, string> = {
  long:    'LONG-TERM',
  mid:     'MILESTONE',
  project: 'PROJECT',
}

function buildTree(goals: Goal[], projects: Project[]): TreeNode {
  const goalMap = new Map<string, TreeNode>()

  // Build goal nodes
  for (const g of goals) {
    goalMap.set(g.id, {
      id: g.id,
      title: g.title,
      type: g.tier,
      status: g.status,
      weight: g.weight,
      children: [],
    })
  }

  // Attach mid goals to their long-term parents
  const roots: TreeNode[] = []
  for (const g of goals) {
    const node = goalMap.get(g.id)!
    if (g.parent_id && goalMap.has(g.parent_id)) {
      goalMap.get(g.parent_id)!.children!.push(node)
    } else if (!g.parent_id) {
      roots.push(node)
    }
  }

  // Attach projects to their goals
  for (const p of projects) {
    const parent = goalMap.get(p.goal_id)
    if (parent) {
      parent.children!.push({
        id: p.id,
        title: p.title,
        type: 'project',
        status: p.status,
        priority: p.priority_score,
      })
    }
  }

  return { id: 'root', title: 'EDEN', type: 'root', status: 'active', children: roots }
}

export default function LifeMap() {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<TreeNode | null>(null)

  const { data: goalsData } = useQuery<Goal[]>({
    queryKey: ['goals-all'],
    queryFn: () => fetch('/api/goals').then(r => r.json()),
    staleTime: 60_000,
  })

  const { data: projectsData } = useQuery<Project[]>({
    queryKey: ['projects-all'],
    queryFn: () => fetch('/api/projects').then(r => r.json()),
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return

    const goals = goalsData ?? []
    const projects = projectsData ?? []
    const root = buildTree(goals, projects)

    const W = containerRef.current.clientWidth
    const H = containerRef.current.clientHeight

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', W).attr('height', H)

    // Zoomable group
    const g = svg.append('g')
    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.3, 2.5])
        .on('zoom', (event) => g.attr('transform', event.transform))
    )

    // Build hierarchy
    const hierarchy = d3.hierarchy(root, d => d.children)
    const treeLayout = d3.tree<TreeNode>()
      .size([H * 0.8, W * 0.7])
      .separation((a, b) => (a.parent === b.parent ? 1.4 : 2))

    const treeData = treeLayout(hierarchy)

    // Center the tree
    g.attr('transform', `translate(${W * 0.15}, ${H * 0.1})`)

    // Links
    g.selectAll('path.link')
      .data(treeData.links())
      .join('path')
      .attr('class', 'link')
      .attr('d', d3.linkHorizontal<d3.HierarchyPointLink<TreeNode>, d3.HierarchyPointNode<TreeNode>>()
        .x(d => d.y)
        .y(d => d.x)
      )
      .attr('fill', 'none')
      .attr('stroke', 'rgba(0,186,220,0.12)')
      .attr('stroke-width', 1)

    // Nodes
    const node = g.selectAll('g.node')
      .data(treeData.descendants().filter(d => d.data.type !== 'root'))
      .join('g')
      .attr('class', 'node')
      .attr('transform', d => `translate(${d.y}, ${d.x})`)
      .style('cursor', 'pointer')
      .on('click', (_, d) => setSelected(d.data))

    // Node size based on type
    const nodeRadius = (d: d3.HierarchyPointNode<TreeNode>) => {
      if (d.data.type === 'long') return 7
      if (d.data.type === 'mid') return 5
      return 4
    }

    // Outer glow ring for active nodes
    node.filter(d => d.data.status === 'active')
      .append('circle')
      .attr('r', d => nodeRadius(d) + 4)
      .attr('fill', 'none')
      .attr('stroke', d => STATUS_COLOR[d.data.status] ?? '#316a86')
      .attr('stroke-width', 0.5)
      .attr('opacity', 0.2)

    // Main circle
    node.append('circle')
      .attr('r', nodeRadius)
      .attr('fill', d => `${STATUS_COLOR[d.data.status] ?? '#316a86'}22`)
      .attr('stroke', d => STATUS_COLOR[d.data.status] ?? '#316a86')
      .attr('stroke-width', 1)

    // Label
    node.append('text')
      .attr('x', d => d.children ? -12 : 12)
      .attr('dy', '0.32em')
      .attr('text-anchor', d => d.children ? 'end' : 'start')
      .attr('fill', d => {
        if (d.data.type === 'long') return '#cde8f5'
        if (d.data.type === 'mid') return '#9dd4ea'
        return '#5fa8c8'
      })
      .attr('font-size', d => {
        if (d.data.type === 'long') return 12
        if (d.data.type === 'mid') return 10
        return 9
      })
      .attr('font-family', d => d.data.type === 'project' ? 'var(--font-mono)' : 'var(--font-display)')
      .attr('font-weight', d => d.data.type === 'long' ? 600 : 400)
      .attr('letter-spacing', d => d.data.type === 'long' ? '0.06em' : '0.04em')
      .text(d => d.data.title.length > 28 ? d.data.title.slice(0, 28) + '…' : d.data.title)

    // Type badge for long-term goals
    node.filter(d => d.data.type === 'long')
      .append('text')
      .attr('x', d => d.children ? -12 : 12)
      .attr('dy', '-0.9em')
      .attr('text-anchor', d => d.children ? 'end' : 'start')
      .attr('fill', 'rgba(0,186,220,0.35)')
      .attr('font-size', 8)
      .attr('font-family', 'var(--font-mono)')
      .attr('letter-spacing', '0.14em')
      .text(d => TYPE_LABEL[d.data.type] ?? '')

  }, [goalsData, projectsData])

  const goals = goalsData ?? []
  const projects = projectsData ?? []
  const isEmpty = goals.length === 0 && projects.length === 0

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 28, letterSpacing: '0.08em', color: '#cde8f5', margin: 0 }}>
            LIFE MAP
          </h1>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#316a86', letterSpacing: '0.12em' }}>
            {goals.filter(g => g.status === 'active').length} GOALS · {projects.filter(p => p.status === 'active').length} PROJECTS
          </span>
        </div>
        <div style={{ height: 1, background: 'linear-gradient(to right, rgba(0,186,220,0.15) 0%, transparent 80%)', marginTop: 10 }} />
      </div>

      {/* Legend */}
      <div style={{ padding: '8px 20px', display: 'flex', gap: 16, flexShrink: 0 }}>
        {Object.entries(STATUS_COLOR).map(([s, c]) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: c, opacity: 0.8 }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#316a86', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{s}</span>
          </div>
        ))}
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#1e4d6b', marginLeft: 'auto', letterSpacing: '0.08em' }}>
          SCROLL TO ZOOM · DRAG TO PAN · CLICK NODE FOR DETAIL
        </span>
      </div>

      {/* Graph canvas */}
      <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {isEmpty ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#316a86', letterSpacing: '0.14em' }}>NO GOALS FOUND</div>
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 300, color: '#163d55', textAlign: 'center', maxWidth: 260, lineHeight: 1.6 }}>
              Tell Eden what you're working toward and it will build the tree for you.
            </div>
          </div>
        ) : (
          <svg ref={svgRef} style={{ width: '100%', height: '100%' }} />
        )}

        {/* Node detail panel */}
        {selected && (
          <div
            className="hud-panel fade-in"
            style={{ position: 'absolute', bottom: 20, left: 20, width: 240, padding: '12px 14px' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.14em', color: STATUS_COLOR[selected.status] ?? '#316a86' }}>
                {TYPE_LABEL[selected.type] ?? selected.type.toUpperCase()}
              </span>
              <button onClick={() => setSelected(null)} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#316a86' }}>×</button>
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600, color: '#cde8f5', letterSpacing: '0.05em', marginBottom: 8, lineHeight: 1.3 }}>
              {selected.title}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#316a86', letterSpacing: '0.1em' }}>STATUS</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: STATUS_COLOR[selected.status] }}>{selected.status.toUpperCase()}</span>
              </div>
              {selected.weight !== undefined && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#316a86', letterSpacing: '0.1em' }}>WEIGHT</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#5fa8c8' }}>{selected.weight.toFixed(1)}</span>
                </div>
              )}
              {selected.priority !== undefined && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#316a86', letterSpacing: '0.1em' }}>PRIORITY</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#5fa8c8' }}>{selected.priority.toFixed(2)}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
