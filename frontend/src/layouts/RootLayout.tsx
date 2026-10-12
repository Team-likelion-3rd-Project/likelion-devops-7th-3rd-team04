import { Outlet } from 'react-router-dom'
import Header from '../components/Header'
import Footer from '../components/Footer'
import MobileDock from '../components/MobileDock'
import ChatWidget from '../components/ChatWidget'
import './RootLayout.css'

function RootLayout() {
  return (
    <div className="root-layout">
      <Header />
      <main className="root-layout-main">
        <Outlet />
      </main>
      <Footer />
      <MobileDock />
      <ChatWidget />
    </div>
  )
}

export default RootLayout
