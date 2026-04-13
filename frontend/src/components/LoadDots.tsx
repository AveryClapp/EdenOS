export default function LoadDots({ level }: { level: number }) {
  return (
    <span className="text-xs tracking-widest ml-2">
      {[1, 2, 3].map((i) => (
        <span key={i} style={{ color: i <= level ? '#fbbf24' : '#3f3f46' }}>
          ●
        </span>
      ))}
    </span>
  )
}
