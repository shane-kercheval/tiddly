import type { ReactNode } from 'react'
import { motion } from 'motion/react'

export function Cursor(): ReactNode {
  return (
    <motion.span
      className="ml-px inline-block w-[1.5px] bg-gray-800"
      style={{ height: '1em', verticalAlign: 'text-bottom' }}
      animate={{ opacity: [1, 0] }}
      transition={{ duration: 0.5, repeat: Infinity, repeatType: 'reverse' }}
    />
  )
}
