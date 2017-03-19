module.exports = function (grunt) {
  'use strict';

  grunt.initConfig({

    browserify: {
      debug: {
        files: {
          'build/bundle.js': 'app/app.js'
        },
        options: {
          transform: ['brfs'],
          debug: true
        }
      }
    },

    watch: {
      app: {
        files: 'app/**/*.js',
        tasks: ['browserify']
      }
    }

  });

  grunt.loadNpmTasks('grunt-browserify');
  grunt.loadNpmTasks('grunt-contrib-watch');
};
