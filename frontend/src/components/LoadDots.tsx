export default function LoadDots({ level }: { level: number }) {
  return (
    <span className="text-xs tracking-widest ml-2">
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= level ? 'text-zinc-200' : 'text-zinc-700'}>
          ●
        </span>
      ))}
    </span>
  )
}
