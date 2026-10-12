import { useParams } from 'react-router-dom'
import PlaceholderPage from '../components/PlaceholderPage'

const LABELS: Record<string, string> = {
  architecture: '건축',
  design: '디자인',
  nature: '자연',
  eco: '에코',
}

function PhilosophyPage() {
  const { slug } = useParams<{ slug: string }>()
  const label = (slug && LABELS[slug]) ?? '브랜드 가치'

  return <PlaceholderPage title={`브랜드 가치 · ${label}`} />
}

export default PhilosophyPage
