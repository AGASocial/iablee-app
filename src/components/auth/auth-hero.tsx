"use client";

import { useState, useEffect } from 'react';
import Image from 'next/image';

// Curated collection of inspiring images related to digital legacy, security, family, future
// Using Unsplash images - beautiful, high-quality photos
const IMAGE_SOURCES = [
  // Digital security & legacy themes
  'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&h=1600&fit=crop&q=80', // Digital future
  'https://images.unsplash.com/photo-1555949963-aa79dcee981c?w=1200&h=1600&fit=crop&q=80', // Technology
  'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1200&h=1600&fit=crop&q=80', // Security
  'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=1200&h=1600&fit=crop&q=80', // Data protection
  
  // Family & legacy themes
  'https://images.unsplash.com/photo-1522673607200-164d1b6ce486?w=1200&h=1600&fit=crop&q=80', // Family
  'https://images.unsplash.com/photo-1511895426328-dc8714191300?w=1200&h=1600&fit=crop&q=80', // Generations
  'https://images.unsplash.com/photo-1511632765486-a01980e01a18?w=1200&h=1600&fit=crop&q=80', // Memory keeping
  'https://images.unsplash.com/photo-1505852679233-d9fd70aff56d?w=1200&h=1600&fit=crop&q=80', // Legacy
  
  // Abstract & inspiring
  'https://images.unsplash.com/photo-1557672172-298e090bd0f1?w=1200&h=1600&fit=crop&q=80', // Abstract
  'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1200&h=1600&fit=crop&q=80', // Modern tech
  'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=1200&h=1600&fit=crop&q=80', // Innovation
  'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=1200&h=1600&fit=crop&q=80', // Planning
];

// Calculate initial random indices once at module load time
const getInitialIndices = () => {
  const initialIndex = Math.floor(Math.random() * IMAGE_SOURCES.length);
  return {
    current: initialIndex,
    next: (initialIndex + 1) % IMAGE_SOURCES.length,
    preload: (initialIndex + 2) % IMAGE_SOURCES.length,
  };
};

const INITIAL_INDICES = getInitialIndices();

export function AuthHero({ quote, author, children }: { quote: string; author: string; children?: React.ReactNode }) {
  const [currentImageIndex, setCurrentImageIndex] = useState(INITIAL_INDICES.current);
  const [nextImageIndex, setNextImageIndex] = useState(INITIAL_INDICES.next);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [nextImageLoaded, setNextImageLoaded] = useState(false);
  const [preloadImageIndex, setPreloadImageIndex] = useState(INITIAL_INDICES.preload);

  // Calculate image URLs from indices (must be before useEffects that use them)
  const currentImage = IMAGE_SOURCES[currentImageIndex];
  const nextImage = IMAGE_SOURCES[nextImageIndex];
  const preloadImage = IMAGE_SOURCES[preloadImageIndex];

  // Check if next image is loaded (including cached images)
  useEffect(() => {
    // Get the next image URL
    const nextImageUrl = IMAGE_SOURCES[nextImageIndex];
    
    // Reset loaded state when nextImageIndex changes - use setTimeout to avoid synchronous setState
    let isMounted = true;
    const resetTimeout = setTimeout(() => {
      if (isMounted) {
        setNextImageLoaded(false);
      }
    }, 0);
    
    // Preload the next image to check if it's cached or needs loading
    const img = new window.Image();
    img.onload = () => {
      if (isMounted) {
        setNextImageLoaded(true);
      }
    };
    img.onerror = () => {
      if (isMounted) {
        setNextImageLoaded(true); // Allow transition even if image fails
      }
    };
    
    // Start loading the image
    img.src = nextImageUrl;
    
    // If image is already cached and loaded, onload might not fire
    // Check after a short delay
    const timeout = setTimeout(() => {
      if (isMounted && img.complete && img.naturalWidth > 0) {
        setNextImageLoaded(true);
      }
    }, 100);
    
    return () => {
      isMounted = false;
      clearTimeout(resetTimeout);
      clearTimeout(timeout);
    };
  }, [nextImageIndex]);

  // Handle image transitions timer
  useEffect(() => {
    const interval = setInterval(() => {
      // Only transition if the next image is loaded (or after a timeout as fallback)
      if (nextImageLoaded) {
        setIsTransitioning(true);
        setTimeout(() => {
          setCurrentImageIndex(nextImageIndex);
          const newNextIdx = (nextImageIndex + 1) % IMAGE_SOURCES.length;
          setNextImageIndex(newNextIdx);
          setPreloadImageIndex((newNextIdx + 1) % IMAGE_SOURCES.length);
          setIsTransitioning(false);
          setNextImageLoaded(false); // Reset for next cycle
        }, 800);
      }
    }, 6000);

    return () => clearInterval(interval);
  }, [nextImageIndex, nextImageLoaded]);

  return (
    <div className="fixed inset-0 lg:relative flex h-screen lg:h-full lg:min-h-0 min-h-screen flex-col p-6 sm:p-8 lg:p-10 text-white overflow-hidden z-10">
      {/* Background Images with fade transition */}
      <div className="absolute inset-0">
        {/* Current visible image */}
        <div 
          className={`absolute inset-0 transition-opacity duration-1000 ${
            isTransitioning ? 'opacity-0' : 'opacity-100'
          }`}
        >
          <Image
            src={currentImage}
            alt="Background"
            fill
            className="object-cover"
            priority={currentImageIndex === 0}
            quality={85}
            sizes="100vw"
            unoptimized={false}
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.style.display = 'none';
            }}
          />
        </div>
        
        {/* Next image - always rendered but hidden until transition, preloading in background */}
        <div 
          className={`absolute inset-0 transition-opacity duration-1000 ${
            isTransitioning ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ 
            visibility: isTransitioning ? 'visible' : 'hidden',
            pointerEvents: 'none'
          }}
        >
          <Image
            src={nextImage}
            alt="Background"
            fill
            className="object-cover"
            quality={85}
            sizes="100vw"
            unoptimized={false}
            onLoad={() => {
              // Mark next image as loaded when it's ready
              setNextImageLoaded(true);
            }}
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.style.display = 'none';
              // If image fails to load, mark as loaded anyway to prevent blocking
              setNextImageLoaded(true);
            }}
          />
        </div>

        {/* Preload next-next image in background (invisible) */}
        <div className="absolute inset-0 opacity-0 pointer-events-none" style={{ visibility: 'hidden' }}>
          <Image
            src={preloadImage}
            alt="Preload"
            fill
            className="object-cover"
            quality={85}
            sizes="100vw"
            unoptimized={false}
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.style.display = 'none';
            }}
          />
        </div>
      </div>

      {/* Gradient overlay - Primary color with modern gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/85 via-primary/75 to-primary/90" />
      
      {/* Additional overlay for depth and text readability */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/50" />
      
      {/* Subtle vignette effect */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_0%,_rgba(0,0,0,0.2)_100%)]" />

      {/* Animated gradient orbs for extra visual interest */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-primary/30 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      {/* Content */}
      <div className="relative z-20 flex items-center text-base sm:text-lg font-medium">
        {children || (
          <div className="flex items-center group">
            <div className="p-1.5 sm:p-2 rounded-lg bg-white/10 backdrop-blur-sm group-hover:bg-white/20 transition-colors">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5 sm:h-6 sm:w-6"
              >
                <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
              </svg>
            </div>
            <span className="ml-2 sm:ml-3 font-bold text-lg sm:text-xl bg-gradient-to-r from-white to-white/90 bg-clip-text text-transparent drop-shadow-lg">
              iablee
            </span>
          </div>
        )}
      </div>

      {/* Quote at bottom - Shown on desktop/tablet, hidden on mobile to make room for form */}
      <div className="relative z-20 mt-auto hidden lg:block">
        <blockquote className="space-y-3">
          <div className="p-4 sm:p-6 rounded-xl bg-white/5 backdrop-blur-md border border-white/10 shadow-2xl">
            <p className="text-base sm:text-lg font-medium leading-relaxed drop-shadow-lg text-white/95">
              &ldquo;{quote}&rdquo;
            </p>
            <footer className="text-xs sm:text-sm text-white/70 font-light mt-2 sm:mt-3 pt-2 sm:pt-3 border-t border-white/10">
              — {author}
            </footer>
          </div>
        </blockquote>
      </div>
    </div>
  );
}

