export default function Soon({ title }: { title: string }) {
  return (
    <div>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-stone-500">
        Este módulo se construye en el siguiente paso de la Fase 2.
      </p>
    </div>
  )
}
