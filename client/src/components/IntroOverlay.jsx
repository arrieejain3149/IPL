import React, { useState, useEffect } from 'react';
import './IntroOverlay.css';

export default function IntroOverlay() {
  const [stage, setStage] = useState('bouncing'); // 'bouncing' | 'exiting' | 'curtain' | 'finished'

  useEffect(() => {
    let isCancelled = false;

    const runSequence = async () => {
      // 1. Let the ball bounce crisply for 2 cycles (1.6s)
      await new Promise((r) => setTimeout(r, 1600));
      if (isCancelled) return;

      // 2. Fade out logo & ball stage (300ms)
      setStage('exiting');
      await new Promise((r) => setTimeout(r, 300));
      if (isCancelled) return;

      // 3. Slide curtain with Merci-Michel cubic-bezier curve (800ms)
      setStage('curtain');
      await new Promise((r) => setTimeout(r, 800));
      if (isCancelled) return;

      // 4. Complete & unmount
      setStage('finished');
    };

    runSequence();

    return () => {
      isCancelled = true;
    };
  }, []);

  if (stage === 'finished') return null;

  const isExiting = stage === 'exiting' || stage === 'curtain';
  const isCurtainSliding = stage === 'curtain';

  const handleSkip = () => {
    if (stage === 'bouncing') {
      setStage('exiting');
      setTimeout(() => {
        setStage('curtain');
        setTimeout(() => setStage('finished'), 800);
      }, 100);
    }
  };

  return (
    <aside
      id="preloader"
      className={isExiting ? 'is-exiting' : ''}
      onClick={handleSkip}
      title="Click anywhere to skip intro"
    >
      <div className={`logo ${isExiting ? 'hide' : ''}`}>
        <img
          src="/ipl_logo.svg"
          alt="IPL Logo"
          className="ipl-logo-img"
        />
        <span className="auction-text">Auction</span>
      </div>

      <div className="preloader-ball-stage">
        <span className="shadow"></span>
        <div className="ball-wrapper">
          <div className="ball-squish">
            <img
              src="/preloader_ball.png"
              className="ball"
              alt="loading"
            />
          </div>
        </div>
      </div>

      <figure
        className={`preloader-background ${isCurtainSliding ? 'curtain-exit' : ''}`}
      ></figure>
    </aside>
  );
}
